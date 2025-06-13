const path = require('path');

class MockFileSystem {
  constructor() {
    this.files = new Map();
    this.directories = new Set();
    this.readOperations = [];
    this.writeOperations = [];
    this.deleteOperations = [];
    this.errorSimulation = null;
  }

  // Симуляция fs.readFile
  readFile(filePath, encoding, callback) {
    if (typeof encoding === 'function') {
      callback = encoding;
      encoding = null;
    }

    this.readOperations.push({ filePath, encoding, timestamp: Date.now() });

    // Симуляция ошибок
    if (this.errorSimulation && this.errorSimulation.operation === 'readFile') {
      const error = this.errorSimulation.error;
      this.errorSimulation = null;
      return callback(error);
    }

    // Проверяем существование файла
    if (!this.files.has(filePath)) {
      return callback(new Error(`ENOENT: no such file or directory, open '${filePath}'`));
    }

    const content = this.files.get(filePath);
    callback(null, encoding ? content : Buffer.from(content));
  }

  // Синхронная версия
  readFileSync(filePath, encoding) {
    this.readOperations.push({ filePath, encoding, timestamp: Date.now(), sync: true });

    if (this.errorSimulation && this.errorSimulation.operation === 'readFileSync') {
      const error = this.errorSimulation.error;
      this.errorSimulation = null;
      throw error;
    }

    if (!this.files.has(filePath)) {
      throw new Error(`ENOENT: no such file or directory, open '${filePath}'`);
    }

    const content = this.files.get(filePath);
    return encoding ? content : Buffer.from(content);
  }

  // Симуляция fs.writeFile
  writeFile(filePath, data, options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }

    this.writeOperations.push({ filePath, data, options, timestamp: Date.now() });

    if (this.errorSimulation && this.errorSimulation.operation === 'writeFile') {
      const error = this.errorSimulation.error;
      this.errorSimulation = null;
      return callback(error);
    }

    // Создаем директорию если нужно
    const dir = path.dirname(filePath);
    this.directories.add(dir);

    // Записываем файл
    this.files.set(filePath, data.toString());
    callback(null);
  }

  // Синхронная версия
  writeFileSync(filePath, data, options) {
    this.writeOperations.push({ filePath, data, options, timestamp: Date.now(), sync: true });

    if (this.errorSimulation && this.errorSimulation.operation === 'writeFileSync') {
      const error = this.errorSimulation.error;
      this.errorSimulation = null;
      throw error;
    }

    const dir = path.dirname(filePath);
    this.directories.add(dir);
    this.files.set(filePath, data.toString());
  }

  // Симуляция fs.unlink
  unlink(filePath, callback) {
    this.deleteOperations.push({ filePath, timestamp: Date.now() });

    if (this.errorSimulation && this.errorSimulation.operation === 'unlink') {
      const error = this.errorSimulation.error;
      this.errorSimulation = null;
      return callback(error);
    }

    if (!this.files.has(filePath)) {
      return callback(new Error(`ENOENT: no such file or directory, unlink '${filePath}'`));
    }

    this.files.delete(filePath);
    callback(null);
  }

  // Синхронная версия
  unlinkSync(filePath) {
    this.deleteOperations.push({ filePath, timestamp: Date.now(), sync: true });

    if (this.errorSimulation && this.errorSimulation.operation === 'unlinkSync') {
      const error = this.errorSimulation.error;
      this.errorSimulation = null;
      throw error;
    }

    if (!this.files.has(filePath)) {
      throw new Error(`ENOENT: no such file or directory, unlink '${filePath}'`);
    }

    this.files.delete(filePath);
  }

  // Симуляция fs.existsSync
  existsSync(filePath) {
    return this.files.has(filePath) || this.directories.has(filePath);
  }

  // Симуляция fs.mkdirSync
  mkdirSync(dirPath, options = {}) {
    if (this.errorSimulation && this.errorSimulation.operation === 'mkdirSync') {
      const error = this.errorSimulation.error;
      this.errorSimulation = null;
      throw error;
    }

    if (options.recursive) {
      // Создаем все родительские директории
      const parts = dirPath.split(path.sep);
      let currentPath = '';
      
      for (const part of parts) {
        if (part) {
          currentPath = path.join(currentPath, part);
          this.directories.add(currentPath);
        }
      }
    } else {
      this.directories.add(dirPath);
    }
  }

  // Симуляция fs.readdirSync
  readdirSync(dirPath) {
    if (this.errorSimulation && this.errorSimulation.operation === 'readdirSync') {
      const error = this.errorSimulation.error;
      this.errorSimulation = null;
      throw error;
    }

    if (!this.directories.has(dirPath)) {
      throw new Error(`ENOENT: no such file or directory, scandir '${dirPath}'`);
    }

    // Возвращаем файлы в этой директории
    const files = [];
    for (const [filePath] of this.files) {
      if (path.dirname(filePath) === dirPath) {
        files.push(path.basename(filePath));
      }
    }

    return files;
  }

  // Симуляция fs.statSync
  statSync(filePath) {
    if (this.errorSimulation && this.errorSimulation.operation === 'statSync') {
      const error = this.errorSimulation.error;
      this.errorSimulation = null;
      throw error;
    }

    const isFile = this.files.has(filePath);
    const isDirectory = this.directories.has(filePath);

    if (!isFile && !isDirectory) {
      throw new Error(`ENOENT: no such file or directory, stat '${filePath}'`);
    }

    return {
      isFile: () => isFile,
      isDirectory: () => isDirectory,
      size: isFile ? this.files.get(filePath).length : 0,
      mtime: new Date(),
      ctime: new Date(),
      atime: new Date()
    };
  }

  // Методы для настройки мока в тестах
  addFile(filePath, content = '') {
    const dir = path.dirname(filePath);
    this.directories.add(dir);
    this.files.set(filePath, content);
  }

  addDirectory(dirPath) {
    this.directories.add(dirPath);
  }

  removeFile(filePath) {
    this.files.delete(filePath);
  }

  removeDirectory(dirPath) {
    this.directories.delete(dirPath);
  }

  getFileContent(filePath) {
    return this.files.get(filePath);
  }

  getAllFiles() {
    return Array.from(this.files.keys());
  }

  getAllDirectories() {
    return Array.from(this.directories);
  }

  // Симуляция ошибок
  simulateError(operation, error) {
    this.errorSimulation = { operation, error };
  }

  simulatePermissionError(operation) {
    this.simulateError(operation, new Error(`EACCES: permission denied, ${operation}`));
  }

  simulateNoSpaceError(operation) {
    this.simulateError(operation, new Error(`ENOSPC: no space left on device, ${operation}`));
  }

  simulateCorruptedFileError(operation) {
    this.simulateError(operation, new Error(`EIO: i/o error, ${operation}`));
  }

  // Методы для проверки в тестах
  getReadOperations() {
    return [...this.readOperations];
  }

  getWriteOperations() {
    return [...this.writeOperations];
  }

  getDeleteOperations() {
    return [...this.deleteOperations];
  }

  wasFileRead(filePath) {
    return this.readOperations.some(op => op.filePath === filePath);
  }

  wasFileWritten(filePath) {
    return this.writeOperations.some(op => op.filePath === filePath);
  }

  wasFileDeleted(filePath) {
    return this.deleteOperations.some(op => op.filePath === filePath);
  }

  clear() {
    this.files.clear();
    this.directories.clear();
    this.readOperations = [];
    this.writeOperations = [];
    this.deleteOperations = [];
    this.errorSimulation = null;
  }

  // Специальные утилиты для тестирования загрузки файлов
  createMockMulterFile(filename, content, mimetype = 'text/plain') {
    return {
      fieldname: 'file',
      originalname: filename,
      encoding: '7bit',
      mimetype: mimetype,
      size: content.length,
      destination: '/tmp/uploads',
      filename: filename,
      path: `/tmp/uploads/${filename}`,
      buffer: Buffer.from(content)
    };
  }

  createMockImageFile(filename = 'test.jpg', size = 1024) {
    return this.createMockMulterFile(filename, 'fake-image-data'.repeat(size / 15), 'image/jpeg');
  }

  createMockCSVFile(filename = 'test.csv', rows = 10) {
    const header = 'id,text,author,theme,source\n';
    const data = Array.from({ length: rows }, (_, i) => 
      `${i + 1},"Test quote ${i + 1}","Test Author ${i + 1}","Test Theme","Test Source"`
    ).join('\n');
    
    return this.createMockMulterFile(filename, header + data, 'text/csv');
  }
}

module.exports = MockFileSystem;