import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Host-side Speech-to-Text manager for AntiParkingLot.
 *
 * Runs outside the sandboxed MCP App iframe so microphone dictation works
 * reliably in Electron / Antigravity without interrupting any running chat agent.
 *
 * Strategy on Windows:
 *   1. WinRT Windows.Media.SpeechRecognition.SpeechRecognizer (neural/cloud speech
 *      with automatic punctuation — same engine behind Windows Voice Typing).
 *   2. Automatic fallback to .NET System.Speech.Recognition.SpeechRecognitionEngine
 *      (offline DictationGrammar) if Online Speech Recognition is disabled or offline.
 */
const PS_VOICE_WORKER = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
$stopFile = $env:PARKING_LOT_VOICE_STOP_FILE

function Emit-Json($obj) {
  $json = $obj | ConvertTo-Json -Compress
  [Console]::WriteLine($json)
  [Console]::Out.Flush()
}

function Run-OfflineSystemSpeech {
  Add-Type -AssemblyName System.Speech
  $culture = [System.Globalization.CultureInfo]::GetCultureInfo('en-US')
  $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine($culture)
  try {
    $engine.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
    $engine.SetInputToDefaultAudioDevice()
  } catch {
    Emit-Json @{ type = 'error'; message = ('Microphone unavailable: ' + $_.Exception.Message) }
    return
  }

  $hypSub = Register-ObjectEvent -InputObject $engine -EventName SpeechHypothesized -Action {
    $t = $Event.SourceEventArgs.Result.Text
    if ($t) {
      [Console]::WriteLine((@{ type = 'partial'; text = $t } | ConvertTo-Json -Compress))
      [Console]::Out.Flush()
    }
  }
  $recSub = Register-ObjectEvent -InputObject $engine -EventName SpeechRecognized -Action {
    $t = $Event.SourceEventArgs.Result.Text
    if ($t) {
      [Console]::WriteLine((@{ type = 'final'; text = $t } | ConvertTo-Json -Compress))
      [Console]::Out.Flush()
    }
  }

  try {
    $engine.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
    Emit-Json @{ type = 'ready'; engine = 'windows-offline-speech' }
    while (-not (Test-Path -LiteralPath $stopFile)) {
      Start-Sleep -Milliseconds 120
    }
    $engine.RecognizeAsyncStop()
    Start-Sleep -Milliseconds 220
  } finally {
    Unregister-Event -SourceIdentifier $hypSub.Name -ErrorAction SilentlyContinue
    Unregister-Event -SourceIdentifier $recSub.Name -ErrorAction SilentlyContinue
    $engine.Dispose()
  }
}

$useFallback = $false
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  [void][Windows.Media.SpeechRecognition.SpeechRecognizer, Windows.Media, ContentType = WindowsRuntime]
  [void][Windows.Foundation.IAsyncAction, Windows.Foundation, ContentType = WindowsRuntime]

  $asTaskOp = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'
  })[0]
  $asTaskAct = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction'
  })[0]

  $recognizer = New-Object Windows.Media.SpeechRecognition.SpeechRecognizer
  $recognizer.Timeouts.InitialSilenceTimeout = [TimeSpan]::FromSeconds(15)
  $recognizer.Timeouts.EndSilenceTimeout = [TimeSpan]::FromMilliseconds(1100)
  $recognizer.Timeouts.BabbleTimeout = [TimeSpan]::FromSeconds(0)

  $compileTask = $asTaskOp.MakeGenericMethod([Windows.Media.SpeechRecognition.SpeechRecognitionCompilationResult]).Invoke($null, @($recognizer.CompileConstraintsAsync()))
  $compileRes = $compileTask.GetAwaiter().GetResult()
  if ($compileRes.Status.ToString() -ne 'Success') {
    $recognizer.Dispose()
    $useFallback = $true
  } else {
    Emit-Json @{ type = 'ready'; engine = 'windows-neural-speech' }
    try {
      while (-not (Test-Path -LiteralPath $stopFile)) {
        $recOp = $recognizer.RecognizeAsync()
        $recTask = $asTaskOp.MakeGenericMethod([Windows.Media.SpeechRecognition.SpeechRecognitionResult]).Invoke($null, @($recOp))
        while (-not $recTask.Wait(140)) {
          if (Test-Path -LiteralPath $stopFile) {
            try {
              $stopTask = $asTaskAct.Invoke($null, @($recognizer.StopRecognitionAsync()))
              [void]$stopTask.Wait(1200)
            } catch {}
            break
          }
        }
        if ($recTask.IsCompleted -and -not $recTask.IsFaulted -and -not $recTask.IsCanceled) {
          $res = $recTask.GetAwaiter().GetResult()
          $statusStr = $res.Status.ToString()
          if ($statusStr -eq 'Success') {
            if ($res.Text) {
              Emit-Json @{ type = 'final'; text = $res.Text }
            }
          } elseif ($statusStr -match 'PrivacyPolicy|NetworkFailure|NotSupported|TopicLanguageNotSupported') {
            $useFallback = $true
            break
          }
        }
      }
    } finally {
      $recognizer.Dispose()
    }
  }
} catch {
  $useFallback = $true
}

if ($useFallback -and -not (Test-Path -LiteralPath $stopFile)) {
  Run-OfflineSystemSpeech
}

Emit-Json @{ type = 'stopped' }
`;

export class VoiceDictationManager {
  constructor() {
    this.proc = null;
    this.stopFile = null;
    this.active = false;
    this.engine = null;
    this.partials = '';
    this.finalChunks = [];
    this.cursor = 0;
    this.error = null;
    this.stdoutBuf = '';
  }

  isSupportedPlatform() {
    return process.platform === 'win32';
  }

  start() {
    if (!this.isSupportedPlatform()) {
      return {
        supported: false,
        active: false,
        reason: 'unsupported_platform',
      };
    }

    if (this.active && this.proc) {
      return this.getStatus();
    }

    this._cleanupStopFile();
    this.stopFile = path.join(os.tmpdir(), `anti-parking-lot-voice-stop-${process.pid}-${Date.now()}.flag`);
    this.active = true;
    this.engine = 'starting';
    this.partials = '';
    this.finalChunks = [];
    this.cursor = 0;
    this.error = null;
    this.stdoutBuf = '';

    const encoded = Buffer.from(PS_VOICE_WORKER, 'utf16le').toString('base64');
    this.proc = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Sta', '-EncodedCommand', encoded],
      {
        env: {
          ...process.env,
          PARKING_LOT_VOICE_STOP_FILE: this.stopFile,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      }
    );

    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk) => {
      this.stdoutBuf += chunk;
      let nlIdx;
      while ((nlIdx = this.stdoutBuf.indexOf('\n')) >= 0) {
        const line = this.stdoutBuf.slice(0, nlIdx).trim();
        this.stdoutBuf = this.stdoutBuf.slice(nlIdx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'ready') {
            this.engine = msg.engine || 'windows-speech';
          } else if (msg.type === 'partial') {
            this.partials = String(msg.text || '');
          } else if (msg.type === 'final' && msg.text) {
            this.finalChunks.push(String(msg.text).trim());
            this.partials = '';
          } else if (msg.type === 'error') {
            this.error = String(msg.message || 'Voice input failed');
            this.active = false;
          } else if (msg.type === 'stopped') {
            this.active = false;
            this.partials = '';
          }
        } catch {
          // Ignore non-JSON diagnostic lines
        }
      }
    });

    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', (chunk) => {
      const msg = chunk.trim();
      if (msg && !this.error) {
        this.error = msg.split('\n')[0].slice(0, 200);
      }
    });

    this.proc.on('exit', () => {
      this.active = false;
      this.proc = null;
      this._cleanupStopFile();
    });

    return this.getStatus();
  }

  poll(sinceCursor = 0) {
    const startIdx = Math.max(0, Number(sinceCursor) || 0);
    const newSegments = this.finalChunks.slice(startIdx);
    this.cursor = this.finalChunks.length;
    return {
      supported: true,
      active: this.active,
      engine: this.engine,
      newSegments,
      partial: this.partials,
      nextCursor: this.finalChunks.length,
      error: this.error,
    };
  }

  async stop(sinceCursor = 0) {
    if (this.stopFile) {
      try {
        fs.writeFileSync(this.stopFile, 'stop', 'utf8');
      } catch {}
    }

    if (this.proc) {
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          try {
            this.proc?.kill();
          } catch {}
          resolve();
        }, 1600);
        this.proc.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }

    this.active = false;
    this.partials = '';
    this._cleanupStopFile();
    return this.poll(sinceCursor);
  }

  getStatus() {
    return {
      supported: this.isSupportedPlatform(),
      active: this.active,
      engine: this.engine,
      partial: this.partials,
      nextCursor: this.finalChunks.length,
      error: this.error,
    };
  }

  _cleanupStopFile() {
    if (this.stopFile) {
      try {
        fs.rmSync(this.stopFile, { force: true });
      } catch {}
      this.stopFile = null;
    }
  }
}
