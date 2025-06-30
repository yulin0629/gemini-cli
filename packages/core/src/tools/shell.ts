/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { Config } from '../config/config.js';
import {
  BaseTool,
  ToolResult,
  ToolCallConfirmationDetails,
  ToolExecuteConfirmationDetails,
  ToolConfirmationOutcome,
} from './tools.js';
import { SchemaValidator } from '../utils/schemaValidator.js';
import { getErrorMessage } from '../utils/errors.js';
import stripAnsi from 'strip-ansi';

export interface ShellToolParams {
  command: string;
  description?: string;
  directory?: string;
}
import { spawn } from 'child_process';

const OUTPUT_UPDATE_INTERVAL_MS = 1000;

export class ShellTool extends BaseTool<ShellToolParams, ToolResult> {
  static Name: string = 'run_shell_command';
  private whitelist: Set<string> = new Set();

  constructor(private readonly config: Config) {
    super(
      ShellTool.Name,
      'Shell',
      `This tool executes a given shell command as \`bash -c <command>\`. Command can start background processes using \`&\`. Command is executed as a subprocess that leads its own process group. Command process group can be terminated as \`kill -- -PGID\` or signaled as \`kill -s SIGNAL -- -PGID\`.

The following information is returned:

Command: Executed command.
Directory: Directory (relative to project root) where command was executed, or \`(root)\`.
Stdout: Output on stdout stream. Can be \`(empty)\` or partial on error and for any unwaited background processes.
Stderr: Output on stderr stream. Can be \`(empty)\` or partial on error and for any unwaited background processes.
Error: Error or \`(none)\` if no error was reported for the subprocess.
Exit Code: Exit code or \`(none)\` if terminated by signal.
Signal: Signal number or \`(none)\` if no signal was received.
Background PIDs: List of background processes started or \`(none)\`.
Process Group PGID: Process group started or \`(none)\``,
      {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'Exact bash command to execute as `bash -c <command>`',
          },
          description: {
            type: 'string',
            description:
              'Brief description of the command for the user. Be specific and concise. Ideally a single sentence. Can be up to 3 sentences for clarity. No line breaks.',
          },
          directory: {
            type: 'string',
            description:
              '(OPTIONAL) Directory to run the command in, if not the project root directory. Must be relative to the project root directory and must already exist.',
          },
        },
        required: ['command'],
      },
      false, // output is not markdown
      true, // output can be updated
    );
  }

  getDescription(params: ShellToolParams): string {
    let description = `${params.command}`;
    // append optional [in directory]
    // note description is needed even if validation fails due to absolute path
    if (params.directory) {
      description += ` [in ${params.directory}]`;
    }
    // append optional (description), replacing any line breaks with spaces
    if (params.description) {
      description += ` (${params.description.replace(/\n/g, ' ')})`;
    }
    return description;
  }

  getCommandRoot(command: string): string | undefined {
    return command
      .trim() // remove leading and trailing whitespace
      .replace(/[{}()]/g, '') // remove all grouping operators
      .split(/[\s;&|]+/)[0] // split on any whitespace or separator or chaining operators and take first part
      ?.split(/[/\\]/) // split on any path separators (or return undefined if previous line was undefined)
      .pop(); // take last part and return command root (or undefined if previous line was empty)
  }

  isCommandAllowed(command: string): boolean {
    const normalize = (cmd: string) => cmd.trim().replace(/\s+/g, ' ');

    const extractCommands = (tools: string[]): string[] =>
      tools.flatMap((tool) => {
        if (tool.startsWith(`${ShellTool.name}(`) && tool.endsWith(')')) {
          return [normalize(tool.slice(ShellTool.name.length + 1, -1))];
        } else if (
          tool.startsWith(`${ShellTool.Name}(`) &&
          tool.endsWith(')')
        ) {
          return [normalize(tool.slice(ShellTool.Name.length + 1, -1))];
        }
        return [];
      });

    const coreTools = this.config.getCoreTools() || [];
    const excludeTools = this.config.getExcludeTools() || [];

    if (
      excludeTools.includes(ShellTool.name) ||
      excludeTools.includes(ShellTool.Name)
    ) {
      return false;
    }

    const blockedCommands = extractCommands(excludeTools);
    const normalizedCommand = normalize(command);

    if (blockedCommands.includes(normalizedCommand)) {
      return false;
    }

    const hasSpecificCommands = coreTools.some(
      (tool) =>
        (tool.startsWith(`${ShellTool.name}(`) && tool.endsWith(')')) ||
        (tool.startsWith(`${ShellTool.Name}(`) && tool.endsWith(')')),
    );

    if (hasSpecificCommands) {
      // If the generic `ShellTool` is also present, it acts as a wildcard,
      // allowing all commands (that are not explicitly blocked).
      if (
        coreTools.includes(ShellTool.name) ||
        coreTools.includes(ShellTool.Name)
      ) {
        return true;
      }

      // Otherwise, we are in strict allow-list mode.
      const allowedCommands = extractCommands(coreTools);
      return allowedCommands.includes(normalizedCommand);
    }

    return true;
  }

  validateToolParams(params: ShellToolParams): string | null {
    if (!this.isCommandAllowed(params.command)) {
      return `Command is not allowed: ${params.command}`;
    }
    if (
      !SchemaValidator.validate(
        this.parameterSchema as Record<string, unknown>,
        params,
      )
    ) {
      return `Parameters failed schema validation.`;
    }
    if (!params.command.trim()) {
      return 'Command cannot be empty.';
    }
    if (!this.getCommandRoot(params.command)) {
      return 'Could not identify command root to obtain permission from user.';
    }
    if (params.directory) {
      if (path.isAbsolute(params.directory)) {
        return 'Directory cannot be absolute. Must be relative to the project root directory.';
      }
      const directory = path.resolve(
        this.config.getTargetDir(),
        params.directory,
      );
      if (!fs.existsSync(directory)) {
        return 'Directory must exist.';
      }
    }
    return null;
  }

  async shouldConfirmExecute(
    params: ShellToolParams,
    _abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    if (this.validateToolParams(params)) {
      return false; // skip confirmation, execute call will fail immediately
    }
    const rootCommand = this.getCommandRoot(params.command)!; // must be non-empty string post-validation
    if (this.whitelist.has(rootCommand)) {
      return false; // already approved and whitelisted
    }
    const confirmationDetails: ToolExecuteConfirmationDetails = {
      type: 'exec',
      title: 'Confirm Shell Command',
      command: params.command,
      rootCommand,
      onConfirm: async (outcome: ToolConfirmationOutcome) => {
        if (outcome === ToolConfirmationOutcome.ProceedAlways) {
          this.whitelist.add(rootCommand);
        }
      },
    };
    return confirmationDetails;
  }

  async execute(
    params: ShellToolParams,
    abortSignal: AbortSignal,
    updateOutput?: (chunk: string) => void,
  ): Promise<ToolResult> {
    const validationError = this.validateToolParams(params);
    if (validationError) {
      return {
        llmContent: [
          `Command rejected: ${params.command}`,
          `Reason: ${validationError}`,
        ].join('\n'),
        returnDisplay: `Error: ${validationError}`,
      };
    }

    if (abortSignal.aborted) {
      return {
        llmContent: 'Command was cancelled by user before it could start.',
        returnDisplay: 'Command cancelled by user.',
      };
    }

    const isWindows = os.platform() === 'win32';
    const tempFileName = `shell_pgrep_${crypto
      .randomBytes(6)
      .toString('hex')}.tmp`;
    const tempFilePath = path.join(os.tmpdir(), tempFileName);

    // pgrep is not available on Windows, so we can't get background PIDs
    const command = isWindows
      ? params.command
      : (() => {
          // wrap command to append subprocess pids (via pgrep) to temporary file
          let command = params.command.trim();
          if (!command.endsWith('&')) command += ';';
          return `{ ${command} }; __code=$?; pgrep -g 0 >${tempFilePath} 2>&1; exit $__code;`;
        })();

    // spawn command in specified directory (or project root if not specified)
    const shell = isWindows
      ? spawn('cmd.exe', ['/c', command], {
          stdio: ['ignore', 'pipe', 'pipe'],
          // detached: true, // ensure subprocess starts its own process group (esp. in Linux)
          cwd: path.resolve(this.config.getTargetDir(), params.directory || ''),
        })
      : spawn('bash', ['-c', command], {
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: true, // ensure subprocess starts its own process group (esp. in Linux)
          cwd: path.resolve(this.config.getTargetDir(), params.directory || ''),
        });

    let exited = false;
    let stdout = '';
    let output = '';
    let lastUpdateTime = Date.now();

    const appendOutput = (str: string) => {
      output += str;
      if (
        updateOutput &&
        Date.now() - lastUpdateTime > OUTPUT_UPDATE_INTERVAL_MS
      ) {
        updateOutput(output);
        lastUpdateTime = Date.now();
      }
    };

    shell.stdout.on('data', (data: Buffer) => {
      // continue to consume post-exit for background processes
      // removing listeners can overflow OS buffer and block subprocesses
      // destroying (e.g. shell.stdout.destroy()) can terminate subprocesses via SIGPIPE
      if (!exited) {
        const str = stripAnsi(data.toString());
        stdout += str;
        appendOutput(str);
      }
    });

    let stderr = '';
    shell.stderr.on('data', (data: Buffer) => {
      if (!exited) {
        const str = stripAnsi(data.toString());
        stderr += str;
        appendOutput(str);
      }
    });

    let error: Error | null = null;
    shell.on('error', (err: Error) => {
      error = err;
      // remove wrapper from user's command in error message
      error.message = error.message.replace(command, params.command);
    });

    let code: number | null = null;
    let processSignal: NodeJS.Signals | null = null;
    const exitHandler = (
      _code: number | null,
      _signal: NodeJS.Signals | null,
    ) => {
      exited = true;
      code = _code;
      processSignal = _signal;
    };
    shell.on('exit', exitHandler);

    const abortHandler = async () => {
      if (shell.pid && !exited) {
        if (os.platform() === 'win32') {
          // For Windows, use taskkill to kill the process tree
          spawn('taskkill', ['/pid', shell.pid.toString(), '/f', '/t']);
        } else {
          try {
            // attempt to SIGTERM process group (negative PID)
            // fall back to SIGKILL (to group) after 200ms
            process.kill(-shell.pid, 'SIGTERM');
            await new Promise((resolve) => setTimeout(resolve, 200));
            if (shell.pid && !exited) {
              process.kill(-shell.pid, 'SIGKILL');
            }
          } catch (_e) {
            // if group kill fails, fall back to killing just the main process
            try {
              if (shell.pid) {
                shell.kill('SIGKILL');
              }
            } catch (_e) {
              console.error(`failed to kill shell process ${shell.pid}: ${_e}`);
            }
          }
        }
      }
    };
    abortSignal.addEventListener('abort', abortHandler);

    // wait for the shell to exit
    try {
      await new Promise((resolve) => shell.on('exit', resolve));
    } finally {
      abortSignal.removeEventListener('abort', abortHandler);
    }

    // parse pids (pgrep output) from temporary file and remove it
    const backgroundPIDs: number[] = [];
    if (os.platform() !== 'win32') {
      if (fs.existsSync(tempFilePath)) {
        const pgrepLines = fs
          .readFileSync(tempFilePath, 'utf8')
          .split('\n')
          .filter(Boolean);
        for (const line of pgrepLines) {
          if (!/^\d+$/.test(line)) {
            console.error(`pgrep: ${line}`);
          }
          const pid = Number(line);
          // exclude the shell subprocess pid
          if (pid !== shell.pid) {
            backgroundPIDs.push(pid);
          }
        }
        fs.unlinkSync(tempFilePath);
      } else {
        if (!abortSignal.aborted) {
          console.error('missing pgrep output');
        }
      }
    }

    let llmContent = '';
    if (abortSignal.aborted) {
      llmContent = 'Command was cancelled by user before it could complete.';
      if (output.trim()) {
        llmContent += ` Below is the output (on stdout and stderr) before it was cancelled:\n${output}`;
      } else {
        llmContent += ' There was no output before it was cancelled.';
      }
    } else {
      llmContent = [
        `Command: ${params.command}`,
        `Directory: ${params.directory || '(root)'}`,
        `Stdout: ${stdout || '(empty)'}`,
        `Stderr: ${stderr || '(empty)'}`,
        `Error: ${error ?? '(none)'}`,
        `Exit Code: ${code ?? '(none)'}`,
        `Signal: ${processSignal ?? '(none)'}`,
        `Background PIDs: ${backgroundPIDs.length ? backgroundPIDs.join(', ') : '(none)'}`,
        `Process Group PGID: ${shell.pid ?? '(none)'}`,
      ].join('\n');
    }

    let returnDisplayMessage = '';
    if (this.config.getDebugMode()) {
      returnDisplayMessage = llmContent;
    } else {
      if (output.trim()) {
        returnDisplayMessage = output;
      } else {
        // Output is empty, let's provide a reason if the command failed or was cancelled
        if (abortSignal.aborted) {
          returnDisplayMessage = 'Command cancelled by user.';
        } else if (processSignal) {
          returnDisplayMessage = `Command terminated by signal: ${processSignal}`;
        } else if (error) {
          // If error is not null, it's an Error object (or other truthy value)
          returnDisplayMessage = `Command failed: ${getErrorMessage(error)}`;
        } else if (code !== null && code !== 0) {
          returnDisplayMessage = `Command exited with code: ${code}`;
        }
        // If output is empty and command succeeded (code 0, no error/signal/abort),
        // returnDisplayMessage will remain empty, which is fine.
      }
    }

    return { llmContent, returnDisplay: returnDisplayMessage };
  }
}
