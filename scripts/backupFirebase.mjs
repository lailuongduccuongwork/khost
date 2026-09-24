import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { deleteApp, initializeApp } from 'firebase/app';
import { get, getDatabase, goOffline, ref } from 'firebase/database';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const args = process.argv.slice(2);
const statusOnly = args.includes('--status');
const reasonArg = args.find((arg) => arg.startsWith('--reason='));
const reason = reasonArg?.slice('--reason='.length) || 'manual';
const destinationArg = args.find((arg) => arg.startsWith('--destination='));
const READ_TIMEOUT_MS = 120_000;
const userConfigPath = path.join(os.homedir(), 'Library', 'Application Support', 'K-Host Backup', 'config.json');

const loadEnvFile = (fileName) => {
    const filePath = path.join(repoRoot, fileName);
    if (!fs.existsSync(filePath)) return;
    for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const equalIndex = line.indexOf('=');
        if (equalIndex < 1) continue;
        const key = line.slice(0, equalIndex).trim();
        const value = line.slice(equalIndex + 1).trim().replace(/^['"]|['"]$/g, '');
        if (!process.env[key]) process.env[key] = value;
    }
};

const resolveBackupRoot = () => {
    const explicit = destinationArg?.slice('--destination='.length) || process.env.KHOST_BACKUP_DIR;
    if (explicit) return path.resolve(explicit.replace(/^~(?=$|\/)/, os.homedir()));

    if (fs.existsSync(userConfigPath)) {
        try {
            const savedConfig = JSON.parse(fs.readFileSync(userConfigPath, 'utf8'));
            if (savedConfig?.backupRoot) return path.resolve(savedConfig.backupRoot);
        } catch {
            // Fall through to automatic detection if the local preference is damaged.
        }
    }

    const cloudStorageRoot = path.join(os.homedir(), 'Library', 'CloudStorage');
    if (fs.existsSync(cloudStorageRoot)) {
        const googleDrive = fs
            .readdirSync(cloudStorageRoot, { withFileTypes: true })
            .find((entry) => entry.isDirectory() && entry.name.startsWith('GoogleDrive'));
        if (googleDrive) {
            const accountRoot = path.join(cloudStorageRoot, googleDrive.name);
            const myDrive = fs
                .readdirSync(accountRoot, { withFileTypes: true })
                .find((entry) => entry.isDirectory() && !entry.name.startsWith('.'));
            if (myDrive) return path.join(accountRoot, myDrive.name, 'K-Host Backups');
        }
    }

    const iCloudRoot = path.join(
        os.homedir(),
        'Library',
        'Mobile Documents',
        'com~apple~CloudDocs'
    );
    if (fs.existsSync(iCloudRoot)) return path.join(iCloudRoot, 'K-Host Backups');

    return path.join(os.homedir(), 'Documents', 'K-Host Backups');
};

const pad = (value) => String(value).padStart(2, '0');
const localDateParts = (date = new Date()) => ({
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    month: `${date.getFullYear()}-${pad(date.getMonth() + 1)}`,
    timestamp: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`,
});

const ensurePrivateDirectory = (directory) => {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    try {
        fs.chmodSync(directory, 0o700);
    } catch {
        // Some synced/external volumes do not expose POSIX permission changes.
    }
};

const writeAtomic = (filePath, content) => {
    ensurePrivateDirectory(path.dirname(filePath));
    const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    const handle = fs.openSync(tempPath, 'w', 0o600);
    try {
        fs.writeFileSync(handle, content);
        fs.fsyncSync(handle);
    } finally {
        fs.closeSync(handle);
    }
    fs.renameSync(tempPath, filePath);
    try {
        fs.chmodSync(filePath, 0o600);
    } catch {
        // See ensurePrivateDirectory.
    }
};

const metadataPathFor = (archivePath) => archivePath.replace(/\.json\.gz$/, '.metadata.json');

const removeArchive = (archivePath) => {
    fs.rmSync(archivePath, { force: true });
    fs.rmSync(metadataPathFor(archivePath), { force: true });
};

export const pruneArchives = (directory, keep) => {
    if (!fs.existsSync(directory)) return [];
    const archives = fs
        .readdirSync(directory)
        .filter((name) => name.endsWith('.json.gz'))
        .sort()
        .reverse();
    const removed = archives.slice(keep);
    removed.forEach((name) => removeArchive(path.join(directory, name)));
    return removed;
};

const archiveMetadata = ({ now, archivePath, compressed, jsonBuffer, data }) => {
    const tenants = data?.tenants && typeof data.tenants === 'object' ? Object.values(data.tenants) : [];
    const summary = tenants.reduce(
        (totals, tenant) => {
            if (!tenant || typeof tenant !== 'object') return totals;
            totals.bookings += tenant.bookings && typeof tenant.bookings === 'object' ? Object.keys(tenant.bookings).length : 0;
            totals.rooms += tenant.rooms && typeof tenant.rooms === 'object' ? Object.keys(tenant.rooms).length : 0;
            totals.customers += tenant.customers && typeof tenant.customers === 'object' ? Object.keys(tenant.customers).length : 0;
            return totals;
        },
        { tenants: tenants.length, bookings: 0, rooms: 0, customers: 0 }
    );

    return {
        formatVersion: 1,
        createdAt: now.toISOString(),
        reason,
        projectId: process.env.VITE_FIREBASE_PROJECT_ID,
        databaseHost: new URL(process.env.VITE_FIREBASE_DATABASE_URL).host,
        archiveFile: path.basename(archivePath),
        uncompressedBytes: jsonBuffer.length,
        compressedBytes: compressed.length,
        sha256: crypto.createHash('sha256').update(compressed).digest('hex'),
        summary,
    };
};

const writeArchive = (archivePath, compressed, metadata) => {
    writeAtomic(archivePath, compressed);
    writeAtomic(metadataPathFor(archivePath), `${JSON.stringify(metadata, null, 2)}\n`);
};

const verifyArchive = (archivePath, expectedHash) => {
    const stored = fs.readFileSync(archivePath);
    const actualHash = crypto.createHash('sha256').update(stored).digest('hex');
    if (actualHash !== expectedHash) throw new Error(`Checksum mismatch: ${archivePath}`);
    JSON.parse(zlib.gunzipSync(stored).toString('utf8'));
};

const copyArchive = (sourcePath, destinationPath, sourceMetadata, copyReason) => {
    const compressed = fs.readFileSync(sourcePath);
    const metadata = {
        ...sourceMetadata,
        reason: copyReason,
        archiveFile: path.basename(destinationPath),
        copiedFrom: path.basename(sourcePath),
    };
    writeArchive(destinationPath, compressed, metadata);
    verifyArchive(destinationPath, metadata.sha256);
};

const ensureReadme = (backupRoot) => {
    const readmePath = path.join(backupRoot, 'README.txt');
    if (fs.existsSync(readmePath)) return;
    writeAtomic(
        readmePath,
        [
            'K-HOST FIREBASE BACKUPS',
            '',
            'Các tệp .json.gz là bản xuất toàn bộ Firebase Realtime Database.',
            'Để khôi phục: giải nén tệp, kiểm tra tệp .metadata.json cùng tên, sau đó dùng Import JSON trong Firebase Console.',
            'Luôn khôi phục thử vào một dự án Firebase riêng trước khi thay thế dữ liệu đang hoạt động.',
            'Không gửi các tệp này qua email hoặc nơi công cộng vì chúng chứa dữ liệu khách và cấu hình hệ thống.',
            '',
        ].join('\n')
    );
};

const showStatus = (backupRoot) => {
    const statusPath = path.join(backupRoot, 'backup-status.json');
    console.log(`Thư mục backup: ${backupRoot}`);
    if (!fs.existsSync(statusPath)) {
        console.log('Chưa có bản backup thành công.');
        process.exitCode = 2;
        return;
    }
    const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
    console.log(`Backup gần nhất: ${status.lastSuccessAt}`);
    console.log(`Loại: ${status.reason}`);
    console.log(`Tệp: ${status.archivePath}`);
    console.log(`Dung lượng nén: ${status.compressedBytes} bytes`);
};

loadEnvFile('.env');
loadEnvFile('.env.local');

const backupRoot = resolveBackupRoot();
if (statusOnly) {
    showStatus(backupRoot);
    process.exit();
}

const requiredEnvKeys = [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_DATABASE_URL',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_STORAGE_BUCKET',
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
    'VITE_FIREBASE_APP_ID',
];
const missingKeys = requiredEnvKeys.filter((key) => !process.env[key]);
if (missingKeys.length > 0) {
    throw new Error(`Thiếu cấu hình Firebase: ${missingKeys.join(', ')}`);
}

const now = new Date();
const dateParts = localDateParts(now);
const dailyDir = path.join(backupRoot, 'daily');
const monthlyDir = path.join(backupRoot, 'monthly');
const manualDir = path.join(backupRoot, 'manual');
const preUpdateDir = path.join(backupRoot, 'pre-update');
const dailyPath = path.join(dailyDir, `khost-${dateParts.date}.json.gz`);
const monthlyPath = path.join(monthlyDir, `khost-${dateParts.month}.json.gz`);

ensurePrivateDirectory(backupRoot);
ensurePrivateDirectory(dailyDir);
ensurePrivateDirectory(monthlyDir);
ensurePrivateDirectory(manualDir);
ensurePrivateDirectory(preUpdateDir);
ensureReadme(backupRoot);

if (reason === 'scheduled' && fs.existsSync(dailyPath)) {
    if (!fs.existsSync(monthlyPath)) {
        const existingMetadata = JSON.parse(fs.readFileSync(metadataPathFor(dailyPath), 'utf8'));
        copyArchive(dailyPath, monthlyPath, existingMetadata, 'monthly');
    }
    pruneArchives(dailyDir, 30);
    pruneArchives(monthlyDir, 12);
    console.log(`Hôm nay đã có backup: ${dailyPath}`);
    process.exit();
}

const firebaseConfig = {
    apiKey: process.env.VITE_FIREBASE_API_KEY,
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
    databaseURL: process.env.VITE_FIREBASE_DATABASE_URL,
    projectId: process.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.VITE_FIREBASE_APP_ID,
    measurementId: process.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const app = initializeApp(firebaseConfig, `khost-backup-${process.pid}`);
const db = getDatabase(app);

try {
    const readNode = (nodePath) =>
        Promise.race([
            get(ref(db, nodePath)),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`Quá thời gian tải vùng ${nodePath} từ Firebase.`)), READ_TIMEOUT_MS)
            ),
        ]);
    // The production rules intentionally deny root reads while allowing these two top-level scopes.
    // Reading them independently produces the same restorable root JSON without weakening the rules.
    const [systemSnapshot, tenantsSnapshot] = await Promise.all([readNode('system'), readNode('tenants')]);
    if (!systemSnapshot.exists() || !tenantsSnapshot.exists()) {
        throw new Error('Firebase trả về dữ liệu thiếu; dừng backup để tránh tạo bản sao không hợp lệ.');
    }

    const data = {
        system: systemSnapshot.exportVal(),
        tenants: tenantsSnapshot.exportVal(),
    };
    if (!data.tenants || !data.system) {
        throw new Error('Cấu trúc dữ liệu Firebase không hợp lệ; không tạo backup.');
    }

    const jsonBuffer = Buffer.from(`${JSON.stringify(data)}\n`, 'utf8');
    const compressed = zlib.gzipSync(jsonBuffer, { level: zlib.constants.Z_BEST_COMPRESSION });

    let primaryPath = dailyPath;
    if (reason === 'pre-update') {
        primaryPath = path.join(preUpdateDir, `khost-pre-update-${dateParts.timestamp}.json.gz`);
    } else if (reason === 'manual') {
        primaryPath = path.join(manualDir, `khost-manual-${dateParts.timestamp}.json.gz`);
    }

    const primaryMetadata = archiveMetadata({ now, archivePath: primaryPath, compressed, jsonBuffer, data });
    writeArchive(primaryPath, compressed, primaryMetadata);
    verifyArchive(primaryPath, primaryMetadata.sha256);

    if (!fs.existsSync(dailyPath)) {
        copyArchive(primaryPath, dailyPath, primaryMetadata, 'daily');
    }
    if (!fs.existsSync(monthlyPath)) {
        copyArchive(primaryPath, monthlyPath, primaryMetadata, 'monthly');
    }

    pruneArchives(dailyDir, 30);
    pruneArchives(monthlyDir, 12);
    pruneArchives(manualDir, 30);
    pruneArchives(preUpdateDir, 30);

    const status = {
        lastSuccessAt: now.toISOString(),
        reason,
        archivePath: primaryPath,
        compressedBytes: compressed.length,
        sha256: primaryMetadata.sha256,
        summary: primaryMetadata.summary,
    };
    writeAtomic(path.join(backupRoot, 'backup-status.json'), `${JSON.stringify(status, null, 2)}\n`);

    console.log(`Backup thành công: ${primaryPath}`);
    console.log(
        `Đã lưu ${primaryMetadata.summary.bookings} đơn, ${primaryMetadata.summary.rooms} phòng, ${primaryMetadata.summary.customers} khách.`
    );
} finally {
    goOffline(db);
    await deleteApp(app);
}

// Firebase's Node transport may leave an idle handle alive after a completed read.
// A backup is a one-shot job, so end explicitly after every verified successful run.
process.exit(0);
