import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const LABEL = 'com.khost.firebase-backup';
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const args = process.argv.slice(2);
const uninstall = args.includes('--uninstall');
const destinationArg = args.find((arg) => arg.startsWith('--destination='));
const uid = process.getuid();
const domain = `gui/${uid}`;
const service = `${domain}/${LABEL}`;
const launchAgentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
const plistPath = path.join(launchAgentsDir, `${LABEL}.plist`);
const logDir = path.join(os.homedir(), 'Library', 'Logs', 'K-Host Backup');
const configDir = path.join(os.homedir(), 'Library', 'Application Support', 'K-Host Backup');
const configPath = path.join(configDir, 'config.json');

const escapeXml = (value) =>
    String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;');

const runLaunchctl = (...launchArgs) =>
    spawnSync('/bin/launchctl', launchArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const shellQuote = (value) => `'${String(value).replaceAll("'", `'\\''`)}'`;

if (uninstall) {
    runLaunchctl('bootout', service);
    fs.rmSync(plistPath, { force: true });
    console.log('Đã gỡ lịch backup tự động. Các tệp backup vẫn được giữ nguyên.');
    process.exit();
}

let backupRoot;
if (destinationArg) {
    backupRoot = path.resolve(destinationArg.slice('--destination='.length).replace(/^~(?=$|\/)/, os.homedir()));
} else {
    const cloudStorageRoot = path.join(os.homedir(), 'Library', 'CloudStorage');
    const googleDrive = fs.existsSync(cloudStorageRoot)
        ? fs
            .readdirSync(cloudStorageRoot, { withFileTypes: true })
            .find((entry) => entry.isDirectory() && entry.name.startsWith('GoogleDrive'))
        : null;
    if (googleDrive) {
        const accountRoot = path.join(cloudStorageRoot, googleDrive.name);
        const myDrive = fs
            .readdirSync(accountRoot, { withFileTypes: true })
            .find((entry) => entry.isDirectory() && !entry.name.startsWith('.'));
        if (myDrive) backupRoot = path.join(accountRoot, myDrive.name, 'K-Host Backups');
    }
    if (!backupRoot) {
        const iCloudRoot = path.join(os.homedir(), 'Library', 'Mobile Documents', 'com~apple~CloudDocs');
        backupRoot = fs.existsSync(iCloudRoot)
            ? path.join(iCloudRoot, 'K-Host Backups')
            : path.join(os.homedir(), 'Documents', 'K-Host Backups');
    }
}

fs.mkdirSync(launchAgentsDir, { recursive: true });
fs.mkdirSync(logDir, { recursive: true });
fs.mkdirSync(backupRoot, { recursive: true });
fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
fs.writeFileSync(configPath, `${JSON.stringify({ backupRoot }, null, 2)}\n`, { mode: 0o600 });

const backupScript = path.join(scriptDir, 'backupFirebase.mjs');
const manualCommandPath = path.join(backupRoot, 'Sao lưu K-Host ngay.command');
fs.writeFileSync(
    manualCommandPath,
    [
        '#!/bin/zsh',
        `export KHOST_BACKUP_DIR=${shellQuote(backupRoot)}`,
        `cd ${shellQuote(repoRoot)}`,
        `${shellQuote(process.execPath)} ${shellQuote(backupScript)} --reason=manual`,
        'result=$?',
        'echo',
        'if [ "$result" -eq 0 ]; then',
        '  echo "Sao lưu hoàn tất. Bạn có thể đóng cửa sổ này."',
        'else',
        '  echo "Sao lưu thất bại. Vui lòng giữ cửa sổ này để kiểm tra lỗi."',
        'fi',
        'read -k 1 "?Nhấn phím bất kỳ để đóng..."',
        'echo',
        'exit "$result"',
        '',
    ].join('\n'),
    { mode: 0o700 }
);
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${escapeXml(process.execPath)}</string>
        <string>${escapeXml(backupScript)}</string>
        <string>--reason=scheduled</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${escapeXml(repoRoot)}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>${escapeXml(os.homedir())}</string>
        <key>KHOST_BACKUP_DIR</key>
        <string>${escapeXml(backupRoot)}</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>22</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
    <key>ProcessType</key>
    <string>Background</string>
    <key>StandardOutPath</key>
    <string>${escapeXml(path.join(logDir, 'backup.log'))}</string>
    <key>StandardErrorPath</key>
    <string>${escapeXml(path.join(logDir, 'backup-error.log'))}</string>
</dict>
</plist>
`;

fs.writeFileSync(plistPath, plist, { mode: 0o600 });
runLaunchctl('bootout', service);
const bootstrap = runLaunchctl('bootstrap', domain, plistPath);
if (bootstrap.status !== 0) {
    throw new Error(`Không thể cài lịch backup: ${(bootstrap.stderr || bootstrap.stdout || '').trim()}`);
}
runLaunchctl('enable', service);
const start = runLaunchctl('kickstart', '-k', service);
if (start.status !== 0) {
    throw new Error(`Đã cài lịch nhưng không thể chạy thử: ${(start.stderr || start.stdout || '').trim()}`);
}

console.log('Đã cài backup tự động lúc 22:00 mỗi ngày và khi đăng nhập lại vào Mac.');
console.log(`Thư mục đồng bộ: ${backupRoot}`);
console.log(`Sao lưu thủ công: nhấp đúp “${path.basename(manualCommandPath)}” trong thư mục trên.`);
console.log(`Nhật ký: ${logDir}`);
