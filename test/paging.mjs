// Clients list paging math (pageWindow in public/desk-app.js).
import fs from "node:fs";
const src = fs.readFileSync(new URL("../public/desk-app.js", import.meta.url), "utf8");
const line = src.match(/^function pageWindow\(.*$/m)?.[0];
const pageWindow = new Function(line + "\nreturn pageWindow;")();

const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let p = pageWindow(312, 2, 20);
ok(p.start === 20 && p.end === 40 && p.pages === 16, "page 2 of 312 at 20 a page shows 21–40 of 16 pages");
ok(eq(p.nums, [1, 2, 3, "…", 16]), "page numbers near the start skip the middle");
ok(eq(pageWindow(312, 8, 20).nums, [1, "…", 7, 8, 9, "…", 16]), "page numbers in the middle show neighbors and both ends");
p = pageWindow(312, 16, 20); ok(p.start === 300 && p.end === 312, "the last page holds the leftover 12");
p = pageWindow(312, 99, 20); ok(p.page === 16, "a page past the end moves back to the last page");
p = pageWindow(300, 16, 20); ok(p.page === 15 && p.start === 280 && p.end === 300, "deleting the last leads on a page moves to the previous page");
p = pageWindow(0, 3, 50); ok(p.page === 1 && p.pages === 1 && p.start === 0 && p.end === 0 && eq(p.nums, [1]), "an empty list is one empty page");
p = pageWindow(100, 1, 100); ok(p.pages === 1 && p.end === 100, "exactly one full page");
p = pageWindow(101, 0, 50); ok(p.page === 1 && p.pages === 3, "page 0 or junk clamps to page 1");
p = pageWindow(10000, 100, 100); ok(p.start === 9900 && p.end === 10000 && p.nums.length <= 7, "big books stay a handful of page buttons");
