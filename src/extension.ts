// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { MisccodeFs } from "./fileSystemProvider";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Filesystem
  const misccodeFs = new MisccodeFs(context.secrets);

  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider("misccodefs", misccodeFs, {
      isCaseSensitive: true,
    }),
  );

  // Password for MySQL
  const secretStorage = context.secrets;
  context.subscriptions.push(
    vscode.commands.registerCommand("misccode.setPassword", async () => {
      const dbPass =
        (await vscode.window.showInputBox({
          password: true,
          title: "Password",
        })) ?? "";
      secretStorage.store("dbPass", dbPass);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("misccode.workspaceInit", () => {
      vscode.workspace.updateWorkspaceFolders(0, 0, {
        uri: vscode.Uri.parse("misccodefs:/"),
        name: "Misccode",
      });
    }),
  );
}

// This method is called when your extension is deactivated
export function deactivate() {}
