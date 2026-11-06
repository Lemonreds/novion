// Copies the freshly bundled debug .app into ./release so there is exactly one
// place to look for a build: release/Novion-debug.app
import { cpSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(process.cwd());
const source = join(root, "src-tauri", "target", "debug", "bundle", "macos", "Novion.app");
const target = join(root, "release", "Novion-debug.app");

if (!existsSync(source)) {
  console.error(`没有找到构建产物：${source}`);
  console.error("请先运行 pnpm app:build。");
  process.exit(1);
}

const binary = join(source, "Contents", "MacOS", "novion");
if (!existsSync(binary)) {
  console.error(`构建产物不完整（缺少可执行文件）：${binary}`);
  process.exit(1);
}

mkdirSync(join(root, "release"), { recursive: true });
// replace the previous copy so a stale bundle can never be opened by accident
rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });

const size = (statSync(join(target, "Contents", "MacOS", "novion")).size / 1024 / 1024).toFixed(1);
console.log(`已复制到 release/Novion-debug.app（可执行文件 ${size} MB）`);
console.log("open release/Novion-debug.app");
