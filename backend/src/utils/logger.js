// src/utils/logger.js
// Winston 로거 설정 — 콘솔 + 일별 파일 로테이션

import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logsDir = path.join(__dirname, '..', '..', 'logs');

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack }) => {
    return `${timestamp} [${level.toUpperCase()}]: ${stack || message}`;
  })
);

// JSON 형식 (파일 로그용 — 구조화 검색 용이)
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// 일별 로테이션: 14일 보관, 20MB 제한
const dailyRotateTransport = new DailyRotateFile({
  dirname: logsDir,
  filename: 'smartfarm-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '14d',
  format: fileFormat,
  zippedArchive: true,
});

// 에러 전용 로그 (별도 파일)
const errorRotateTransport = new DailyRotateFile({
  dirname: logsDir,
  filename: 'error-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '30d',
  level: 'error',
  format: fileFormat,
  zippedArchive: true,
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        logFormat
      )
    }),
    dailyRotateTransport,
    errorRotateTransport,
  ]
});

// 로테이션 이벤트 로깅
dailyRotateTransport.on('rotate', (oldFilename, newFilename) => {
  logger.info(`Log rotated: ${oldFilename} → ${newFilename}`);
});

export default logger;
