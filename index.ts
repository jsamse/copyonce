import { sleep } from "bun";
import { Database } from "bun:sqlite";
import { readdir, stat, mkdir, copyFile, watch } from "node:fs/promises";
import { sep } from "node:path";
import { parseArgs } from "util";

class File {
    modified!: number;
    size!: number;
}

const { values, positionals } = parseArgs({
    args: Bun.argv,
    options: {
        interval: {
            type: 'string',
            short: 'i',
        },
        types: {
            type: 'string',
            short: 't',
        },
        help: {
            type: 'boolean',
            short: 'h',
        },
    },
    strict: true,
    allowPositionals: true,
});

if (values.help || positionals.length < 5) {
    console.log("Usage: copyonce [--interval 60 --types pdf,gif] <db> <source> <destination>");
    console.log("");
    console.log("if --interval is set, the program wait that number of seconds between copying again");
    console.log("--types is a comma separated list of file extensions to copy");
    console.log("<db> is the path to the sqlite database to store file information");
    console.log("<src> is the source directory to copy from");
    console.log("<dest> is the destination directory to copy to");
    process.exit();
}

let interval = 0;
if (values.interval) {
    interval = parseInt(values.interval);
}

let types: string[] = [];
if (values.types) {
    types = values.types.split(',');
}

const db = new Database(positionals[2], { strict: true });

process.on("SIGINT", () => {
    db.close();
    process.exit();
});

db.exec("PRAGMA journal_mode = WAL;");
db.run("CREATE TABLE IF NOT EXISTS files (path TEXT NOT NULL PRIMARY KEY, modified INT NOT NULL, size INT NOT NULL)");

const src = positionals[3].endsWith(sep) ? positionals[3].slice(0, -1) : positionals[3];
const dest = positionals[4].endsWith(sep) ? positionals[4].slice(0, -1) : positionals[4];


while (true) {
    const files = (await readdir(src, { recursive: true }));

    for (const file of files) {
        const stats = await stat(`${src}${sep}${file}`);
        const row = db.query("SELECT modified, size FROM files WHERE path = ?").as(File).get(file);
        if (stats.isDirectory()) {
            if (!row) {
                console.log(`Copying directory: ${file}`);
                mkdir(`${dest}${sep}${file}`, { recursive: true });
                db.run("INSERT INTO files (path, modified, size) VALUES (?, ?, ?)", [file, stats.mtimeMs, 0]);
            }
        }
        if (stats.isFile()) {
            if ((!row || row.modified !== stats.mtimeMs || row.size !== stats.size) && (types.length === 0 || types.includes(file.split('.').pop() || ''))) {
                console.log(`Copying file: ${file}`);
                await copyFile(`${src}${sep}${file}`, `${dest}${sep}${file}`);
                db.run("INSERT OR REPLACE INTO files (path, modified, size) VALUES (?, ?, ?)", [file, stats.mtimeMs, stats.size]);
            }
        }
    }

    if (interval === 0) {
        process.exit();
    }
    await sleep(interval * 1000);
}