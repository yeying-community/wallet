// IndexedDB 存储模块
const IndexedDB = {

  DB_NAME: 'WalletDB',
  DB_VERSION: 1,
  STORE_TRANSACTIONS: 'transactions',

  /**
   * 打开数据库
   */
  async openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // 创建交易历史表
        if (!db.objectStoreNames.contains(this.STORE_TRANSACTIONS)) {
          const store = db.createObjectStore(this.STORE_TRANSACTIONS, { keyPath: 'id', autoIncrement: true });
          store.createIndex('address', 'address', { unique: false });
          store.createIndex('hash', 'hash', { unique: true });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  /**
   * 保存交易
   * @param {Object} txData 交易数据
   */
  async saveTransaction(txData) {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_TRANSACTIONS, 'readwrite');
      const store = tx.objectStore(this.STORE_TRANSACTIONS);

      store.put({
        address: txData.from.toLowerCase(),
        hash: txData.hash,
        from: txData.from,
        to: txData.to,
        value: txData.value,
        timestamp: txData.timestamp || Date.now(),
        status: txData.status || 'pending',
        network: txData.network,
        source: txData.source || 'wallet'
      });

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  },

  /**
   * 获取某个账户的交易历史
   * @param {string} address 钱包地址
   * @param {number} limit 返回条数限制
   */
  async getTransactionsByAddress(address, limit = 50) {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_TRANSACTIONS, 'readonly');
      const store = tx.objectStore(this.STORE_TRANSACTIONS);
      const index = store.index('address');

      const request = index.getAll(address.toLowerCase());

      request.onsuccess = () => {
        const allTx = request.result;
        // 按时间倒序
        allTx.sort((a, b) => b.timestamp - a.timestamp);
        resolve(allTx.slice(0, limit));
      };
      request.onerror = () => reject(request.error);
    });
  },

  /**
   * 根据交易哈希获取交易
   * @param {string} hash 交易哈希
   */
  async getTransactionByHash(hash) {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_TRANSACTIONS, 'readonly');
      const store = tx.objectStore(this.STORE_TRANSACTIONS);
      const index = store.index('hash');

      const request = index.get(hash);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  },

  /**
   * 更新交易状态
   * @param {string} hash 交易哈希
   * @param {string} status 新状态
   */
  async updateTransactionStatus(hash, status) {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_TRANSACTIONS, 'readwrite');
      const store = tx.objectStore(this.STORE_TRANSACTIONS);
      const index = store.index('hash');

      const request = index.get(hash);
      request.onsuccess = (event) => {
        const record = event.target.result;
        if (record) {
          record.status = status;
          store.put(record);
        }
      };
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  },

  /**
   * 清除某个账户的交易历史
   * @param {string} address 钱包地址
   */
  async clearTransactionsByAddress(address) {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_TRANSACTIONS, 'readwrite');
      const store = tx.objectStore(this.STORE_TRANSACTIONS);
      const index = store.index('address');

      const request = index.openCursor(address.toLowerCase());
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          store.delete(cursor.primaryKey);
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  },

  /**
   * 清除所有交易历史
   */
  async clearAllTransactions() {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_TRANSACTIONS, 'readwrite');
      const store = tx.objectStore(this.STORE_TRANSACTIONS);
      store.clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }
};

