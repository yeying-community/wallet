/**
 * 协议层 - 通用消息协议与扩展内部消息类型
 * 纯数据结构 + 校验 + Builder 工具函数
 */

// ==================== Dapp <-> Extension 协议 ====================

export const PROTOCOL_VERSION = '1.0.0';
export const MESSAGE_TYPE = 'yeying_message';
export const PORT_NAME = 'yeying-wallet';

export const MessageCategory = {
  REQUEST: 'request',
  RESPONSE: 'response',
  EVENT: 'event'
};

export const EventType = {
  CONNECT: 'connect',
  DISCONNECT: 'disconnect',
  ACCOUNTS_CHANGED: 'accountsChanged',
  CHAIN_CHANGED: 'chainChanged',
  MESSAGE: 'message'
};

const INTERNAL_ERROR_CODE = -32603;

function generateId(prefix = 'id') {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 9);
  return `${prefix}_${timestamp}_${random}`;
}

function getTimestamp() {
  return Date.now();
}

function normalizeError(error) {
  if (error && typeof error === 'object') {
    if (typeof error.code === 'number' && error.message) {
      return {
        code: error.code,
        message: error.message,
        ...(error.data !== undefined && { data: error.data })
      };
    }
    if (error.message) {
      return {
        code: INTERNAL_ERROR_CODE,
        message: error.message
      };
    }
  }

  return {
    code: INTERNAL_ERROR_CODE,
    message: 'Internal error'
  };
}

export const MessageBuilder = {
  createRequest(method, params = [], origin = null) {
    return {
      type: MESSAGE_TYPE,
      version: PROTOCOL_VERSION,
      category: MessageCategory.REQUEST,
      payload: {
        method,
        params
      },
      metadata: {
        id: generateId('req'),
        timestamp: getTimestamp(),
        ...(origin && { origin })
      }
    };
  },

  createResponse(result, requestId) {
    return {
      type: MESSAGE_TYPE,
      version: PROTOCOL_VERSION,
      category: MessageCategory.RESPONSE,
      payload: {
        result
      },
      metadata: {
        id: generateId('res'),
        timestamp: getTimestamp(),
        requestId
      }
    };
  },

  createErrorResponse(error, requestId) {
    const errorObj = normalizeError(error);

    return {
      type: MESSAGE_TYPE,
      version: PROTOCOL_VERSION,
      category: MessageCategory.RESPONSE,
      payload: {
        error: {
          code: errorObj.code,
          message: errorObj.message,
          ...(errorObj.data !== undefined && { data: errorObj.data })
        }
      },
      metadata: {
        id: generateId('err'),
        timestamp: getTimestamp(),
        requestId
      }
    };
  },

  createEvent(event, data) {
    return {
      type: MESSAGE_TYPE,
      version: PROTOCOL_VERSION,
      category: MessageCategory.EVENT,
      payload: {
        event,
        data
      },
      metadata: {
        id: generateId('evt'),
        timestamp: getTimestamp()
      }
    };
  }
};

export const MessageValidator = {
  validate(message) {
    if (!message || typeof message !== 'object') {
      return { valid: false, error: 'Message must be an object' };
    }

    if (message.type !== MESSAGE_TYPE) {
      return { valid: false, error: 'Invalid message type' };
    }

    if (!message.version) {
      return { valid: false, error: 'Missing version' };
    }

    if (!message.category || !Object.values(MessageCategory).includes(message.category)) {
      return { valid: false, error: 'Invalid category' };
    }

    if (!message.payload || typeof message.payload !== 'object') {
      return { valid: false, error: 'Invalid payload' };
    }

    if (!message.metadata || typeof message.metadata !== 'object') {
      return { valid: false, error: 'Invalid metadata' };
    }

    if (!message.metadata.id || !message.metadata.timestamp) {
      return { valid: false, error: 'Missing metadata fields' };
    }

    return { valid: true };
  },

  validateRequest(message) {
    const baseValidation = this.validate(message);
    if (!baseValidation.valid) {
      return baseValidation;
    }

    if (message.category !== MessageCategory.REQUEST) {
      return { valid: false, error: 'Not a request message' };
    }

    if (!message.payload.method || typeof message.payload.method !== 'string') {
      return { valid: false, error: 'Invalid method' };
    }

    if (!Array.isArray(message.payload.params)) {
      return { valid: false, error: 'Params must be an array' };
    }

    return { valid: true };
  },

  validateResponse(message) {
    const baseValidation = this.validate(message);
    if (!baseValidation.valid) {
      return baseValidation;
    }

    if (message.category !== MessageCategory.RESPONSE) {
      return { valid: false, error: 'Not a response message' };
    }

    if (!message.metadata.requestId) {
      return { valid: false, error: 'Missing requestId' };
    }

    const hasResult = 'result' in message.payload;
    const hasError = 'error' in message.payload;

    if (!hasResult && !hasError) {
      return { valid: false, error: 'Response must have result or error' };
    }

    if (hasResult && hasError) {
      return { valid: false, error: 'Response cannot have both result and error' };
    }

    if (hasError) {
      const error = message.payload.error;
      if (typeof error.code !== 'number' || !error.message) {
        return { valid: false, error: 'Invalid error format' };
      }
    }

    return { valid: true };
  },

  validateEvent(message) {
    const baseValidation = this.validate(message);
    if (!baseValidation.valid) {
      return baseValidation;
    }

    if (message.category !== MessageCategory.EVENT) {
      return { valid: false, error: 'Not an event message' };
    }

    if (!message.payload.event || typeof message.payload.event !== 'string') {
      return { valid: false, error: 'Invalid event name' };
    }

    return { valid: true };
  },

  isRequest(message) {
    return message && message.category === MessageCategory.REQUEST;
  },

  isResponse(message) {
    return message && message.category === MessageCategory.RESPONSE;
  },

  isEvent(message) {
    return message && message.category === MessageCategory.EVENT;
  },

  isErrorResponse(message) {
    return this.isResponse(message) && 'error' in message.payload;
  },

  isSuccessResponse(message) {
    return this.isResponse(message) && 'result' in message.payload;
  }
};

// ==================== Extension 内部消息类型 ====================

export const WalletMessageType = {
  IS_WALLET_INITIALIZED: 'IS_WALLET_INITIALIZED',
  CREATE_HD_WALLET: 'CREATE_HD_WALLET',
  IMPORT_HD_WALLET: 'IMPORT_HD_WALLET',
  IMPORT_PRIVATE_KEY_WALLET: 'IMPORT_PRIVATE_KEY_WALLET',
  CREATE_SUB_ACCOUNT: 'CREATE_SUB_ACCOUNT',
  SWITCH_ACCOUNT: 'SWITCH_ACCOUNT',
  DELETE_ACCOUNT: 'DELETE_ACCOUNT',
  UPDATE_ACCOUNT_NAME: 'UPDATE_ACCOUNT_NAME',
  GET_BALANCE: 'GET_BALANCE',
  GET_TOKEN_BALANCES: 'GET_TOKEN_BALANCES',
  ADD_TOKEN: 'ADD_TOKEN',
  UNLOCK_WALLET: 'UNLOCK_WALLET',
  LOCK_WALLET: 'LOCK_WALLET',
  EXPORT_PRIVATE_KEY: 'EXPORT_PRIVATE_KEY',
  EXPORT_MNEMONIC: 'EXPORT_MNEMONIC',
  CHANGE_PASSWORD: 'CHANGE_PASSWORD',
  GET_AUTHORIZED_SITES: 'GET_AUTHORIZED_SITES',
  REVOKE_SITE: 'REVOKE_SITE',
  CLEAR_ALL_AUTHORIZATIONS: 'CLEAR_ALL_AUTHORIZATIONS',
  GET_WALLET_STATE: 'GET_WALLET_STATE',
  GET_CURRENT_ACCOUNT: 'GET_CURRENT_ACCOUNT',
  GET_ALL_WALLETS: 'GET_ALL_WALLETS',
  GET_ACCOUNT_BY_ID: 'GET_ACCOUNT_BY_ID',
  UPDATE_POPUP_BOUNDS: 'UPDATE_POPUP_BOUNDS',
  RESET_WALLET: 'RESET_WALLET'
};

export const TransactionMessageType = {
  SEND_TRANSACTION: 'SEND_TRANSACTION',
  SIGN_TRANSACTION: 'SIGN_TRANSACTION',
  SIGN_MESSAGE: 'SIGN_MESSAGE',
  GET_TRANSACTIONS: 'GET_TRANSACTIONS',
  CLEAR_TRANSACTIONS: 'CLEAR_TRANSACTIONS',
  ESTIMATE_GAS: 'ESTIMATE_GAS',
  GET_GAS_PRICE: 'GET_GAS_PRICE'
};

export const NetworkMessageType = {
  SWITCH_NETWORK: 'SWITCH_NETWORK',
  ADD_NETWORK: 'ADD_NETWORK',
  GET_CURRENT_CHAIN_ID: 'GET_CURRENT_CHAIN_ID',
  GET_CURRENT_RPC_URL: 'GET_CURRENT_RPC_URL',
  GET_NETWORK_INFO: 'GET_NETWORK_INFO',
  GET_SUPPORTED_NETWORKS: 'GET_SUPPORTED_NETWORKS',
  ADD_CUSTOM_NETWORK: 'ADD_CUSTOM_NETWORK',
  UPDATE_CUSTOM_NETWORK: 'UPDATE_CUSTOM_NETWORK',
  REMOVE_CUSTOM_NETWORK: 'REMOVE_CUSTOM_NETWORK',
  GET_CUSTOM_NETWORKS: 'GET_CUSTOM_NETWORKS'
};

export const ApprovalMessageType = {
  GET_PENDING_REQUEST: 'GET_PENDING_REQUEST',
  APPROVAL_RESPONSE: 'APPROVAL_RESPONSE'
};
