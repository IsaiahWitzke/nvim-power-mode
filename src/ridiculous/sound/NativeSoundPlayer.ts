import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { spawn, ChildProcess } from "child_process";

/**
 * Native sound player using a persistent PowerShell process to avoid startup delays.
 *
 * Keeps a long-running PowerShell process and sends it commands via stdin.
 * This eliminates the ~100-200ms PowerShell startup overhead on each sound.
 *
 */
export class NativeSoundPlayer {
  private soundPaths: Map<string, string> = new Map();
  private enabled: boolean = true;
  private debugMode: boolean = true;
  private psProcess?: ChildProcess;
  private platform: NodeJS.Platform;
  private psReady: boolean = false;
  private initializationAttempted: boolean = false;

  constructor(private context: vscode.ExtensionContext) {
    this.platform = process.platform;
    this.initializeSoundPaths();
    if (this.platform === "win32") {
      this.initializePersistentProcess();
    }
  }

  private initializeSoundPaths(): void {
    const mediaPath = path.join(this.context.extensionPath, "src", "ridiculous", "media", "sound");

    if (this.debugMode) {
      console.log(`[NativeSoundPlayer] Extension path: ${this.context.extensionPath}`);
      console.log(`[NativeSoundPlayer] Media path: ${mediaPath}`);
    }

    // Base sounds
    this.soundPaths.set("blip", path.join(mediaPath, "blip.wav"));
    this.soundPaths.set("boom", path.join(mediaPath, "boom.wav"));
    this.soundPaths.set("fireworks", path.join(mediaPath, "fireworks.wav"));

    if (this.debugMode) {
      console.log(`[NativeSoundPlayer] Sound paths initialized:`);
      const blipPath = this.soundPaths.get("blip")!;
      const boomPath = this.soundPaths.get("boom")!;
      const fireworksPath = this.soundPaths.get("fireworks")!;
      console.log(`  blip: ${blipPath} (exists: ${fs.existsSync(blipPath)})`);
      console.log(`  boom: ${boomPath} (exists: ${fs.existsSync(boomPath)})`);
      console.log(`  fireworks: ${fireworksPath} (exists: ${fs.existsSync(fireworksPath)})`);
    }

    // Pitch variants for blip (20 variants: 1.05x to 2.0x in 0.05 increments)
    for (let i = 1; i <= 20; i++) {
      const paddedIndex = i.toString().padStart(2, '0');
      this.soundPaths.set(`blip_p${paddedIndex}`, path.join(mediaPath, `blip_p${paddedIndex}.wav`));
    }
  }

  /**
   * Initialize a persistent PowerShell process for Windows
   */
  private initializePersistentProcess(): void {
    if (this.initializationAttempted) {
      return; // Don't try to initialize multiple times
    }
    this.initializationAttempted = true;

    try {
      // Spawn PowerShell in interactive mode with a SoundPlayer that we can control
      this.psProcess = spawn("powershell.exe", [
        "-NoProfile",
        "-NoLogo",
        "-NonInteractive",
        "-Command",
        "-"
      ], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true
      });

      if (this.psProcess.stdout) {
        this.psProcess.stdout.on("data", (data) => {
          if (this.debugMode) {
            console.log(`[NativeSoundPlayer] PS stdout: ${data}`);
          }
        });
      }

      if (this.psProcess.stderr) {
        this.psProcess.stderr.on("data", (data) => {
          console.error(`[NativeSoundPlayer] PS stderr: ${data}`);
        });
      }

      this.psProcess.on("error", (err) => {
        if (this.debugMode) {
          console.error(`[NativeSoundPlayer] PS process error:`, err);
        }
        this.psProcess = undefined;
        this.psReady = false;
        this.initializationAttempted = false; // Allow retry
      });

      this.psProcess.on("exit", (code) => {
        if (this.debugMode) {
          console.log(`[NativeSoundPlayer] PS process exited with code ${code}`);
        }
        this.psProcess = undefined;
        this.psReady = false;
        this.initializationAttempted = false; // Allow retry
      });

      if (this.debugMode) {
        console.log("[NativeSoundPlayer] Persistent PowerShell process initializing...");
      }

      // Initialize the persistent process with a global SoundPlayer variable
      // This allows us to stop sounds by reassigning it
      setTimeout(() => {
        if (this.psProcess && this.psProcess.stdin) {
          // Create a global SoundPlayer variable that we can reuse and stop
          const initCommand = `$global:player = $null\n`;
          this.psProcess.stdin.write(initCommand);

          this.psReady = true;
          if (this.debugMode) {
            console.log("[NativeSoundPlayer] PowerShell process is ready");
          }
        }
      }, 300); // 300ms delay to ensure PowerShell is fully started
    } catch (error) {
      if (this.debugMode) {
        console.error(`[NativeSoundPlayer] Failed to initialize PS process:`, error);
      }
      this.initializationAttempted = false; // Allow retry
    }
  }

  /**
   * Play a sound by name with optional pitch variation.
   * @param soundName - "blip", "boom", or "fireworks"
   * @param pitch - Pitch multiplier (1.0 = normal, 1.05-1.20 for variants)
   */
  public play(soundName: string, pitch: number = 1.0): void {
    if (this.debugMode) {
      console.log(`[NativeSoundPlayer] play() called: sound=${soundName}, pitch=${pitch}, enabled=${this.enabled}`);
    }

    if (!this.enabled) {
      if (this.debugMode) {
        console.log(`[NativeSoundPlayer] Sound playback disabled, skipping`);
      }
      return;
    }

    // Select appropriate sound file based on pitch
    // Pitch formula: 1.0 + Math.min(20, pitchIncrease) * 0.05
    // Range: 1.0 (first key) to 2.0 (20th+ key) in 0.05 increments
    // Matches webview exactly!
    let selectedSound = soundName;
    if (soundName === "blip" && pitch > 1.0) {
      // Calculate which variant to use based on pitch
      // Round to nearest 0.05 increment
      const variantIndex = Math.round((pitch - 1.0) / 0.05);

      if (variantIndex >= 20) {
        selectedSound = "blip_p20"; // 2.0x (max)
      } else if (variantIndex > 0) {
        // blip_p01 through blip_p19
        const paddedIndex = variantIndex.toString().padStart(2, '0');
        selectedSound = `blip_p${paddedIndex}`;
      }
    }

    let soundPath = this.soundPaths.get(selectedSound);
    // Fallback to base sound if pitch variant doesn't exist
    if (!soundPath && selectedSound !== soundName) {
      if (this.debugMode) {
        console.log(`[NativeSoundPlayer] Pitch variant ${selectedSound} not found, falling back to ${soundName}`);
      }
      soundPath = this.soundPaths.get(soundName);
    }

    if (!soundPath) {
      console.warn(`[NativeSoundPlayer] Unknown sound: ${soundName}`);
      return;
    }

    // Verify file exists before trying to play
    if (!fs.existsSync(soundPath)) {
      console.error(`[NativeSoundPlayer] Sound file does not exist: ${soundPath}`);
      console.error(`[NativeSoundPlayer] Attempted to play: ${selectedSound} (original: ${soundName})`);
      return;
    }

    if (this.debugMode) {
      console.log(`[NativeSoundPlayer] Playing sound at path: ${soundPath}`);
      console.log(`[NativeSoundPlayer] Selected sound: ${selectedSound}`);
      console.log(`[NativeSoundPlayer] File exists: ${fs.existsSync(soundPath)}`);
      console.log(`[NativeSoundPlayer] Platform: ${this.platform}`);
    }

    if (this.platform === "win32") {
      this.playWindows(soundPath, selectedSound);
    } else if (this.platform === "darwin") {
      this.playMacOS(soundPath);
    } else if (this.platform === "linux") {
      this.playLinux(soundPath);
    }
  }

  /**
   * Play sound on Windows using persistent PowerShell process
   */
  private playWindows(filePath: string, soundName: string): void {
    try {
      if (this.debugMode) {
        console.log(`[NativeSoundPlayer] playWindows() called with: ${filePath}`);
        console.log(`[NativeSoundPlayer] psReady=${this.psReady}, psProcess exists=${!!this.psProcess}, stdin exists=${!!this.psProcess?.stdin}`);
      }

      // If persistent process is not ready, try to initialize it
      if (!this.psReady || !this.psProcess || !this.psProcess.stdin) {
        // Try to initialize if not attempted yet
        if (!this.initializationAttempted && !this.psProcess) {
          if (this.debugMode) {
            console.log(`[NativeSoundPlayer] Initializing PowerShell process...`);
          }
          this.initializePersistentProcess();
        }

        // Use fallback for immediate playback while process initializes
        if (this.debugMode) {
          console.log(`[NativeSoundPlayer] Using fallback playback`);
        }
        this.playWindowsFallback(filePath);
        return;
      }

      // Stop any currently playing sound by disposing the old player and creating a new one
      // This ensures sounds interrupt each other for rapid keystrokes
      const command = `if ($global:player) { $global:player.Stop(); $global:player.Dispose(); $global:player = $null }; $global:player = New-Object System.Media.SoundPlayer '${filePath}'; $global:player.Play()\n`;

      if (this.debugMode) {
        console.log(`[NativeSoundPlayer] Sending command to PowerShell: stop and play new sound`);
        console.log(`[NativeSoundPlayer] File path: ${filePath}`);
        console.log(`[NativeSoundPlayer] Command: ${command.substring(0, 150)}...`);
      }
      this.psProcess.stdin.write(command);
    } catch (error) {
      if (this.debugMode) {
        console.error(`[NativeSoundPlayer] Error in playWindows:`, error);
      }
      // Fallback to one-off process
      this.playWindowsFallback(filePath);
    }
  }

  /**
   * Fallback method for Windows when persistent process is unavailable
   */
  private playWindowsFallback(filePath: string): void {
    try {
      if (this.debugMode) {
        console.log(`[NativeSoundPlayer] playWindowsFallback() called with: ${filePath}`);
      }

      // Use async Play() with a small sleep to ensure the process doesn't exit before sound starts
      const command = `(New-Object System.Media.SoundPlayer '${filePath}').Play(); Start-Sleep -Milliseconds 100`;

      const child = spawn("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle", "Hidden",
        "-ExecutionPolicy", "Bypass",
        "-Command",
        command
      ], {
        stdio: "ignore",
        windowsHide: true,
        detached: false
      });

      child.on("error", (err) => {
        if (this.debugMode) {
          console.error(`[NativeSoundPlayer] Fallback spawn error:`, err);
        }
      });

      child.on("exit", (code) => {
        if (this.debugMode) {
          console.log(`[NativeSoundPlayer] Fallback process exited with code: ${code}`);
        }
      });
    } catch (error) {
      if (this.debugMode) {
        console.error(`[NativeSoundPlayer] playWindowsFallback error:`, error);
      }
    }
  }

  /**
   * Play sound on macOS using afplay
   */
  private playMacOS(filePath: string): void {
    try {
      const child = spawn("afplay", [filePath], {
        detached: true,
        stdio: "ignore"
      });
      child.unref();
    } catch (error) {
      // Silent fail
    }
  }

  /**
   * Play sound on Linux using paplay
   */
  private playLinux(filePath: string): void {
    try {
      const child = spawn("paplay", [filePath], {
        detached: true,
        stdio: "ignore"
      });
      child.unref();
    } catch (error) {
      // Silent fail
    }
  }

  /**
   * Set whether sound playback is enabled
   */
  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;

    // When re-enabling native sound, reinitialize PowerShell process if needed
    if (enabled && this.platform === "win32" && !this.psReady) {
      this.initializePersistentProcess();
    }
  }

  /**
   * Dispose resources and stop all sounds
   */
  public dispose(): void {
    // Kill persistent PowerShell process
    if (this.psProcess) {
      try {
        this.psProcess.kill();
      } catch (error) {
        // Ignore
      }
      this.psProcess = undefined;
    }
  }
}
