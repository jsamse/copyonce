import { sleep } from "bun";
import { Database } from "bun:sqlite";
import { readdir, stat, mkdir, copyFile, watch } from "node:fs/promises";
import { sep, dirname } from "node:path";
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
        },
        include: {
            type: 'string',
        },
        exclude: {
            type: 'string',
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
    console.log("Usage: copyonce [--interval 60 --include regexp --exclude regexp] <db> <source> <destination>");
    console.log("");
    console.log("if --interval is set, the program wait that number of seconds between copying again");
    console.log("--include includes only files that match the regular expression, includes everything if not set");
    console.log("--exclude overrides --include");
    console.log("<db> is the path to the sqlite database to store file information");
    console.log("<src> is the source directory to copy from");
    console.log("<dest> is the destination directory to copy to");
    process.exit();
}

let interval = 0;
if (values.interval) {
    interval = parseInt(values.interval);
}

let include: RegExp | undefined = undefined;
if (values.include) {
    include = new RegExp(values.include);
}

let exclude: RegExp | undefined = undefined;
if (values.exclude) {
    exclude = new RegExp(values.exclude);
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
        if (stats.isFile()) {
            if ((!row || row.modified !== stats.mtimeMs || row.size !== stats.size) && (!include || include.test(file)) && (!exclude || !exclude.test(file))) {
                console.log(`Copying file: ${file}`);
                mkdir(`${dest}${sep}${dirname(file)}`, { recursive: true });
                await copyFile(`${src}${sep}${file}`, `${dest}${sep}${file}`);
                db.run("INSERT OR REPLACE INTO files (path, modified, size) VALUES (?, ?, ?)", [file, stats.mtimeMs, stats.size]);
            }
        }
    }

    if (interval === 0) {
        db.close();
        process.exit();
    }
    await sleep(interval * 1000);
}
