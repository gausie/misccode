import * as mysql from "mysql2/promise";
import path = require("node:path");
import * as vscode from "vscode";

export class MisccodeFs implements vscode.FileSystemProvider {
  root: vscode.FileStat = {
    type: vscode.FileType.Directory,
    ctime: Date.now(),
    mtime: Date.now(),
    size: 0,
  };

  private _connection: mysql.Connection | null = null;
  private _secrets: vscode.SecretStorage;

  constructor(secrets: vscode.SecretStorage) {
    this._secrets = secrets;
    this.connection();
  }

  async connection() {
    if (this._connection === null) {
      const config = vscode.workspace.getConfiguration("misccode");
      this._connection = await mysql.createConnection({
        host: config.get<string>("dbHost"),
        user: config.get<string>("dbUser"),
        password: await this._secrets.get("dbPass"),
        database: config.get<string>("dbName"),
      });
    }
    return this._connection;
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    if (uri.path.startsWith("/.vscode")) {
      throw vscode.FileSystemError.FileNotFound();
    }

    if (uri.path === "/") {
      return this.root;
    }

    const conn = await this.connection();
    const name = path.basename(uri.path, ".php");

    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT name FROM zzz_misccode WHERE name = ?",
      [name],
    );

    if (rows.length === 0) {
      throw vscode.FileSystemError.FileNotFound();
    }

    return {
      type: vscode.FileType.File,
      ctime: 0,
      mtime: 0,
      size: 0,
    };
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    if (uri.path !== "/") {
      throw vscode.FileSystemError.FileNotFound();
    }

    const conn = await this.connection();
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT name FROM zzz_misccode",
    );
    return rows.map(
      ({ name }) =>
        [`${name}.php`, vscode.FileType.File] as [string, vscode.FileType],
    );
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    if (uri.path.startsWith("/.vscode")) {
      throw vscode.FileSystemError.FileNotFound();
    }

    const conn = await this.connection();
    const name = path.basename(uri.path, ".php");

    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT code FROM zzz_misccode WHERE name = ?",
      [name],
    );

    if (rows.length === 0) {
      throw vscode.FileSystemError.FileNotFound();
    }

    return Buffer.from("<?\n" + rows[0].code);
  }

  async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: { create: boolean; overwrite: boolean },
  ): Promise<void> {
    const conn = await this.connection();
    const name = path.basename(uri.path, ".php");

    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT * FROM zzz_misccode WHERE name = ?",
      [name],
    );

    const code = content.toString().replace(/^<\?\n?/, "");

    if (rows.length === 0) {
      if (!options.create) {
        throw vscode.FileSystemError.FileNotFound(uri);
      }

      await conn.execute("INSERT INTO zzz_misccode VALUES (?, ?)", [
        name,
        code,
      ]);
      this._fireSoon({ type: vscode.FileChangeType.Created, uri });
      return;
    }

    if (options.create && !options.overwrite) {
      throw vscode.FileSystemError.FileExists(uri);
    }

    await conn.execute("UPDATE zzz_misccode SET code = ? WHERE name = ?", [
      code,
      name,
    ]);
    this._fireSoon({ type: vscode.FileChangeType.Changed, uri });
  }

  async rename(
    oldUri: vscode.Uri,
    newUri: vscode.Uri,
    options: { overwrite: boolean },
  ): Promise<void> {
    const conn = await this.connection();

    const oldName = path.basename(oldUri.path, ".php");
    const newName = path.basename(newUri.path, ".php");

    const [oldRows] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT * FROM zzz_misccode WHERE name = ?",
      [oldName],
    );

    if (!options.overwrite && oldRows.length > 0) {
      throw vscode.FileSystemError.FileNotFound(oldUri);
    }

    const [newRows] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT * FROM zzz_misccode WHERE name = ?",
      [newName],
    );

    if (!options.overwrite && newRows.length > 0) {
      throw vscode.FileSystemError.FileExists(newUri);
    }

    await conn.execute("UPDATE zzz_misccode SET name = ? WHERE name = ?", [
      newName,
      oldName,
    ]);

    this._fireSoon(
      { type: vscode.FileChangeType.Deleted, uri: oldUri },
      { type: vscode.FileChangeType.Created, uri: newUri },
    );
  }

  async delete(uri: vscode.Uri) {
    const conn = await this.connection();

    const name = path.basename(uri.path, ".php");

    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT * FROM zzz_misccode WHERE name = ?",
      [name],
    );

    if (rows.length === 0) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    await conn.query<mysql.RowDataPacket[]>(
      "DELETE FROM zzz_misccode WHERE name = ?",
      [name],
    );

    this._fireSoon(
      { type: vscode.FileChangeType.Changed, uri: vscode.Uri.parse("") },
      { uri, type: vscode.FileChangeType.Deleted },
    );
  }

  createDirectory(_uri: vscode.Uri): void {
    // There are no directories in misccode
    throw vscode.FileSystemError.NoPermissions();
  }

  // --- manage file events

  private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  private _bufferedEvents: vscode.FileChangeEvent[] = [];
  private _fireSoonHandle?: NodeJS.Timer;

  readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> =
    this._emitter.event;

  watch(_resource: vscode.Uri): vscode.Disposable {
    // ignore, fires for all changes...
    return new vscode.Disposable(() => {});
  }

  private _fireSoon(...events: vscode.FileChangeEvent[]): void {
    this._bufferedEvents.push(...events);

    if (this._fireSoonHandle) {
      clearTimeout(this._fireSoonHandle);
    }

    this._fireSoonHandle = setTimeout(() => {
      this._emitter.fire(this._bufferedEvents);
      this._bufferedEvents.length = 0;
    }, 5);
  }
}
