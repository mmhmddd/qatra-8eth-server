import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ════════════════════════════════════════════════
//               LOGGER CONFIGURATION
// ════════════════════════════════════════════════

const LOG_DIR = path.join(__dirname, 'logs');
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB per file
const MAX_LOG_FILES = 10; // Keep last 10 rotated files

// Ensure logs directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Log file paths
const LOG_FILES = {
  all:      path.join(LOG_DIR, 'all.log'),
  users:    path.join(LOG_DIR, 'users.log'),
  deletes:  path.join(LOG_DIR, 'deletes.log'),
  errors:   path.join(LOG_DIR, 'errors.log'),
  security: path.join(LOG_DIR, 'security.log'),
};

// ════════════════════════════════════════════════
//               LOG ROTATION
// ════════════════════════════════════════════════
function rotateLogFile(filePath) {
  try {
    const stats = fs.statSync(filePath);
    if (stats.size >= MAX_LOG_SIZE) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const rotatedPath = filePath.replace('.log', `-${timestamp}.log`);
      fs.renameSync(filePath, rotatedPath);

      // Clean up old rotated files
      const dir = path.dirname(filePath);
      const baseName = path.basename(filePath, '.log');
      const rotatedFiles = fs.readdirSync(dir)
        .filter(f => f.startsWith(baseName + '-') && f.endsWith('.log'))
        .map(f => ({ name: f, time: fs.statSync(path.join(dir, f)).mtime }))
        .sort((a, b) => b.time - a.time);

      rotatedFiles.slice(MAX_LOG_FILES).forEach(f => {
        fs.unlinkSync(path.join(dir, f.name));
      });
    }
  } catch (err) {
    // File might not exist yet, that's fine
  }
}

// ════════════════════════════════════════════════
//               CORE WRITE FUNCTION
// ════════════════════════════════════════════════
function writeLog(filePath, entry) {
  try {
    rotateLogFile(filePath);
    fs.appendFileSync(filePath, entry + '\n', 'utf8');
  } catch (err) {
    console.error('❌ Logger write error:', err.message);
  }
}

// ════════════════════════════════════════════════
//               FORMAT LOG ENTRY
// ════════════════════════════════════════════════
function formatEntry(level, category, action, data) {
  const timestamp = new Date().toISOString();
  const cairoTime = new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' });

  const entry = {
    timestamp,
    cairoTime,
    level,
    category,
    action,
    ...data
  };

  const line = [
    `[${timestamp}]`,
    `[Cairo: ${cairoTime}]`,
    `[${level.toUpperCase()}]`,
    `[${category}]`,
    `[${action}]`,
    JSON.stringify(data)
  ].join(' | ');

  return { line, entry };
}

// ════════════════════════════════════════════════
//               MAIN LOGGER OBJECT
// ════════════════════════════════════════════════
const logger = {

  // ── USER EVENTS ─────────────────────────────
  userCreated({ email, userId, name, createdBy = 'system', requestId = null }) {
    const { line } = formatEntry('INFO', 'USER', 'CREATED', {
      email, userId: String(userId), name, createdBy, requestId
    });
    console.log(`👤 USER CREATED | ${email} | ID: ${userId} | by: ${createdBy}`);
    writeLog(LOG_FILES.all, line);
    writeLog(LOG_FILES.users, line);
  },

  userDeleted({ email, userId, name = null, deletedBy, reason = null, requestId = null, stack = null }) {
    const { line } = formatEntry('WARN', 'USER', 'DELETED', {
      email, userId: String(userId), name, deletedBy, reason, requestId, stack
    });
    console.warn(`🗑️  USER DELETED | ${email} | ID: ${userId} | by: ${deletedBy} | reason: ${reason}`);
    writeLog(LOG_FILES.all, line);
    writeLog(LOG_FILES.users, line);
    writeLog(LOG_FILES.deletes, line);
  },

  userUpdated({ email, userId, changes, updatedBy }) {
    const { line } = formatEntry('INFO', 'USER', 'UPDATED', {
      email, userId: String(userId), changes, updatedBy
    });
    console.log(`✏️  USER UPDATED | ${email} | changes: ${JSON.stringify(changes)}`);
    writeLog(LOG_FILES.all, line);
    writeLog(LOG_FILES.users, line);
  },

  // ── JOIN REQUEST EVENTS ──────────────────────
  joinRequestCreated({ requestId, email, name }) {
    const { line } = formatEntry('INFO', 'JOIN_REQUEST', 'CREATED', {
      requestId: String(requestId), email, name
    });
    console.log(`📝 JOIN REQUEST CREATED | ${name} | ${email} | ID: ${requestId}`);
    writeLog(LOG_FILES.all, line);
    writeLog(LOG_FILES.users, line);
  },

  joinRequestApproved({ requestId, email, name, approvedBy, newUserId, isNewUser }) {
    const { line } = formatEntry('INFO', 'JOIN_REQUEST', 'APPROVED', {
      requestId: String(requestId), email, name,
      approvedBy: String(approvedBy), newUserId: String(newUserId), isNewUser
    });
    console.log(`✅ JOIN REQUEST APPROVED | ${name} | ${email} | newUser: ${isNewUser}`);
    writeLog(LOG_FILES.all, line);
    writeLog(LOG_FILES.users, line);
  },

  joinRequestRejected({ requestId, email, name, rejectedBy }) {
    const { line } = formatEntry('INFO', 'JOIN_REQUEST', 'REJECTED', {
      requestId: String(requestId), email, name, rejectedBy: String(rejectedBy)
    });
    console.log(`❌ JOIN REQUEST REJECTED | ${name} | ${email}`);
    writeLog(LOG_FILES.all, line);
    writeLog(LOG_FILES.users, line);
  },

  joinRequestDeleted({ requestId, email, name, status, deletedBy }) {
    const { line } = formatEntry('WARN', 'JOIN_REQUEST', 'DELETED', {
      requestId: String(requestId), email, name, status, deletedBy: String(deletedBy)
    });
    console.warn(`🗑️  JOIN REQUEST DELETED | ${name} | ${email} | status was: ${status}`);
    writeLog(LOG_FILES.all, line);
    writeLog(LOG_FILES.users, line);
    writeLog(LOG_FILES.deletes, line);
  },

  // ── MEMBER EVENTS ────────────────────────────
  memberDeleted({ memberId, email, name, deletedBy }) {
    const { line } = formatEntry('WARN', 'MEMBER', 'DELETED', {
      memberId: String(memberId), email, name, deletedBy: String(deletedBy)
    });
    console.warn(`🗑️  MEMBER DELETED | ${name} | ${email} | by admin: ${deletedBy}`);
    writeLog(LOG_FILES.all, line);
    writeLog(LOG_FILES.users, line);
    writeLog(LOG_FILES.deletes, line);
  },

  memberUpdated({ memberId, email, name, changes, updatedBy }) {
    const { line } = formatEntry('INFO', 'MEMBER', 'UPDATED', {
      memberId: String(memberId), email, name, changes, updatedBy: String(updatedBy)
    });
    console.log(`✏️  MEMBER UPDATED | ${name} | ${email}`);
    writeLog(LOG_FILES.all, line);
    writeLog(LOG_FILES.users, line);
  },

  // ── STUDENT EVENTS ───────────────────────────
  studentAdded({ memberId, memberEmail, studentEmail, studentName }) {
    const { line } = formatEntry('INFO', 'STUDENT', 'ADDED', {
      memberId: String(memberId), memberEmail, studentEmail, studentName
    });
    console.log(`🎓 STUDENT ADDED | ${studentName} → member: ${memberEmail}`);
    writeLog(LOG_FILES.all, line);
    writeLog(LOG_FILES.users, line);
  },

  // ── AUTH EVENTS ──────────────────────────────
  loginSuccess({ email, userId, ip, role }) {
    const { line } = formatEntry('INFO', 'AUTH', 'LOGIN_SUCCESS', {
      email, userId: String(userId), ip, role
    });
    console.log(`🔐 LOGIN | ${email} | role: ${role} | IP: ${ip}`);
    writeLog(LOG_FILES.all, line);
    writeLog(LOG_FILES.security, line);
  },

  loginFailed({ email, ip, reason }) {
    const { line } = formatEntry('WARN', 'AUTH', 'LOGIN_FAILED', { email, ip, reason });
    console.warn(`⚠️  LOGIN FAILED | ${email} | IP: ${ip} | reason: ${reason}`);
    writeLog(LOG_FILES.all, line);
    writeLog(LOG_FILES.security, line);
  },

  passwordChanged({ email, userId, ip }) {
    const { line } = formatEntry('INFO', 'AUTH', 'PASSWORD_CHANGED', {
      email, userId: String(userId), ip
    });
    console.log(`🔑 PASSWORD CHANGED | ${email}`);
    writeLog(LOG_FILES.all, line);
    writeLog(LOG_FILES.security, line);
  },

  passwordResetRequested({ email, ip }) {
    const { line } = formatEntry('INFO', 'AUTH', 'PASSWORD_RESET_REQUESTED', { email, ip });
    console.log(`📧 PASSWORD RESET REQUESTED | ${email} | IP: ${ip}`);
    writeLog(LOG_FILES.all, line);
    writeLog(LOG_FILES.security, line);
  },

  // ── PROFILE IMAGE EVENTS ─────────────────────
  profileImageUploaded({ email, userId, publicId, url }) {
    const { line } = formatEntry('INFO', 'PROFILE', 'IMAGE_UPLOADED', {
      email, userId: String(userId), publicId, url
    });
    console.log(`🖼️  PROFILE IMAGE UPLOADED | ${email}`);
    writeLog(LOG_FILES.all, line);
    writeLog(LOG_FILES.users, line);
  },

  profileImageDeleted({ email, userId, publicId, deletedBy }) {
    const { line } = formatEntry('WARN', 'PROFILE', 'IMAGE_DELETED', {
      email, userId: String(userId), publicId, deletedBy
    });
    console.warn(`🗑️  PROFILE IMAGE DELETED | ${email}`);
    writeLog(LOG_FILES.all, line);
    writeLog(LOG_FILES.deletes, line);
  },

  // ── DATABASE ANOMALY DETECTION ───────────────
  dbAnomaly({ type, details, severity = 'HIGH' }) {
    const { line } = formatEntry('ERROR', 'DB_ANOMALY', type, { details, severity });
    console.error(`🚨 DB ANOMALY [${severity}] | ${type} | ${JSON.stringify(details)}`);
    writeLog(LOG_FILES.all, line);
    writeLog(LOG_FILES.errors, line);
    writeLog(LOG_FILES.deletes, line);
  },

  // ── GENERAL ERROR ────────────────────────────
  error({ action, error, context = {} }) {
    const { line } = formatEntry('ERROR', 'SERVER', action, {
      errorName: error?.name,
      errorMessage: error?.message,
      errorCode: error?.code,
      stack: error?.stack?.split('\n').slice(0, 5).join(' | '),
      ...context
    });
    console.error(`❌ ERROR | ${action} | ${error?.message}`);
    writeLog(LOG_FILES.all, line);
    writeLog(LOG_FILES.errors, line);
  },

  // ── SERVER EVENTS ────────────────────────────
  serverStarted({ port, environment, mongoState }) {
    const { line } = formatEntry('INFO', 'SERVER', 'STARTED', {
      port, environment, mongoState
    });
    console.log(`🚀 SERVER STARTED | port: ${port} | env: ${environment}`);
    writeLog(LOG_FILES.all, line);
  },

  mongoConnected() {
    const { line } = formatEntry('INFO', 'MONGODB', 'CONNECTED', {});
    console.log('✅ MONGODB CONNECTED');
    writeLog(LOG_FILES.all, line);
  },

  mongoDisconnected({ reason }) {
    const { line } = formatEntry('WARN', 'MONGODB', 'DISCONNECTED', { reason });
    console.warn(`⚠️  MONGODB DISCONNECTED | ${reason}`);
    writeLog(LOG_FILES.all, line);
    writeLog(LOG_FILES.errors, line);
  },

  // ── UTILITY: READ RECENT LOGS ─────────────────
  getRecentLogs(type = 'all', lines = 100) {
    const filePath = LOG_FILES[type] || LOG_FILES.all;
    try {
      if (!fs.existsSync(filePath)) return [];
      const content = fs.readFileSync(filePath, 'utf8');
      return content.trim().split('\n').slice(-lines);
    } catch {
      return [];
    }
  },

  getLogFilePaths() {
    return LOG_FILES;
  }
};

export default logger;