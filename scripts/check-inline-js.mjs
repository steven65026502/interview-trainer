import { readFile } from "node:fs/promises";

const files = process.argv.slice(2);

if (!files.length) {
  console.error("Usage: node scripts/check-inline-js.mjs <html...>");
  process.exit(2);
}

for (const file of files) {
  const html = await readFile(file, "utf8");
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  scripts.forEach((match, index) => {
    try {
      Function(match[1]);
    } catch (error) {
      throw new SyntaxError(`${file}: inline script ${index + 1}: ${error.message}`);
    }
  });
  console.log(`${file}: ${scripts.length} inline script(s) parse OK`);
}
