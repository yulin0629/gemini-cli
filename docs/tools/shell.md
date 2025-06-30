# Shell Tool (`run_shell_command`)

This document describes the `run_shell_command` tool for the Gemini CLI.

## Description

Use `run_shell_command` to interact with the underlying system, run scripts, or perform command-line operations. `run_shell_command` executes a given shell command. On Windows, the command will be executed with `cmd.exe /c`. On other platforms, the command will be executed with `bash -c`.

### Arguments

`run_shell_command` takes the following arguments:

- `command` (string, required): The exact shell command to execute.
- `description` (string, optional): A brief description of the command's purpose, which will be shown to the user.
- `directory` (string, optional): The directory (relative to the project root) in which to execute the command. If not provided, the command runs in the project root.

## How to use `run_shell_command` with the Gemini CLI

When using `run_shell_command`, the command is executed as a subprocess. `run_shell_command` can start background processes using `&`. The tool returns detailed information about the execution, including:

- `Command`: The command that was executed.
- `Directory`: The directory where the command was run.
- `Stdout`: Output from the standard output stream.
- `Stderr`: Output from the standard error stream.
- `Error`: Any error message reported by the subprocess.
- `Exit Code`: The exit code of the command.
- `Signal`: The signal number if the command was terminated by a signal.
- `Background PIDs`: A list of PIDs for any background processes started.

Usage:

```
run_shell_command(command="Your commands.", description="Your description of the command.", directory="Your execution directory.")
```

## `run_shell_command` examples

List files in the current directory:

```
run_shell_command(command="ls -la")
```

Run a script in a specific directory:

```
run_shell_command(command="./my_script.sh", directory="scripts", description="Run my custom script")
```

Start a background server:

```
run_shell_command(command="npm run dev &", description="Start development server in background")
```

## Important notes

- **Security:** Be cautious when executing commands, especially those constructed from user input, to prevent security vulnerabilities.
- **Interactive commands:** Avoid commands that require interactive user input, as this can cause the tool to hang. Use non-interactive flags if available (e.g., `npm init -y`).
- **Error handling:** Check the `Stderr`, `Error`, and `Exit Code` fields to determine if a command executed successfully.
- **Background processes:** When a command is run in the background with `&`, the tool will return immediately and the process will continue to run in the background. The `Background PIDs` field will contain the process ID of the background process.

## Command Restrictions

You can restrict the commands that can be executed by the `run_shell_command` tool by using the `coreTools` and `excludeTools` settings in your configuration file.

- `coreTools`: If you want to restrict the `run_shell_command` tool to a specific set of commands, you can add entries to the `coreTools` list in the format `ShellTool(<command>)`. For example, `"coreTools": ["ShellTool(ls -l)"]` will only allow the `ls -l` command to be executed. If you include `ShellTool` as a general entry in the `coreTools` list, it will act as a wildcard and allow any command to be executed, even if you have other specific commands in the list.
- `excludeTools`: If you want to block specific commands, you can add entries to the `excludeTools` list in the format `ShellTool(<command>)`. For example, `"excludeTools": ["ShellTool(rm -rf /)"]` will block the `rm -rf /` command.

### Command Restriction Examples

Here are some examples of how to use the `coreTools` and `excludeTools` settings to control which commands can be executed.

**Allow only specific commands**

To allow only `ls -l` and `git status`, and block all other commands:

```json
{
  "coreTools": ["ShellTool(ls -l)", "ShellTool(git status)"]
}
```

- `ls -l`: Allowed
- `git status`: Allowed
- `npm install`: Blocked

**Block specific commands**

To block `rm -rf /` and `npm install`, and allow all other commands:

```json
{
  "excludeTools": ["ShellTool(rm -rf /)", "ShellTool(npm install)"]
}
```

- `rm -rf /`: Blocked
- `npm install`: Blocked
- `ls -l`: Allowed

**Allow all commands**

To allow any command to be executed, you can use the `ShellTool` wildcard in `coreTools`:

```json
{
  "coreTools": ["ShellTool"]
}
```

- `ls -l`: Allowed
- `npm install`: Allowed
- `any other command`: Allowed

**Wildcard with specific allowed commands**

If you include the `ShellTool` wildcard along with specific commands, the wildcard takes precedence, and all commands are allowed.

```json
{
  "coreTools": ["ShellTool", "ShellTool(ls -l)"]
}
```

- `ls -l`: Allowed
- `npm install`: Allowed
- `any other command`: Allowed

**Wildcard with a blocklist**

You can use the `ShellTool` wildcard to allow all commands, while still blocking specific commands using `excludeTools`.

```json
{
  "coreTools": ["ShellTool"],
  "excludeTools": ["ShellTool(rm -rf /)"]
}
```

- `rm -rf /`: Blocked
- `ls -l`: Allowed
- `npm install`: Allowed

**Block all shell commands**

To block all shell commands, you can add the `ShellTool` wildcard to `excludeTools`:

```json
{
  "excludeTools": ["ShellTool"]
}
```

- `ls -l`: Blocked
- `npm install`: Blocked
- `any other command`: Blocked

## Security Note for `excludeTools`

Command-specific restrictions in
`excludeTools` for `run_shell_command` are based on simple string matching and can be easily bypassed. This feature is **not a security mechanism** and should not be relied upon to safely execute untrusted code. It is recommended to use `coreTools` to explicitly select commands
that can be executed.
