/**
 * 联系人存储
 * 管理联系人数据的存储和读取
 */

import { ContactsStorageKeys } from './storage-keys.js';
import {
  getMap,
  setMapItem,
  getMapItem,
  deleteMapItem
} from './storage-base.js';
import { logError } from '../common/errors/index.js';

/**
 * 获取联系人 Map
 * @returns {Promise<Object>}
 */
export async function getContactsMap() {
  try {
    return await getMap(ContactsStorageKeys.CONTACTS);
  } catch (error) {
    logError('contact-storage-get-map', error);
    return {};
  }
}

/**
 * 获取联系人列表
 * @returns {Promise<Array>}
 */
export async function getContactList() {
  try {
    const contacts = await getContactsMap();
    return Object.values(contacts || {});
  } catch (error) {
    logError('contact-storage-get-list', error);
    return [];
  }
}

/**
 * 获取联系人
 * @param {string} contactId
 * @returns {Promise<Object|null>}
 */
export async function getContact(contactId) {
  try {
    return await getMapItem(ContactsStorageKeys.CONTACTS, contactId);
  } catch (error) {
    logError('contact-storage-get', error);
    return null;
  }
}

/**
 * 保存联系人
 * @param {Object} contact
 * @returns {Promise<void>}
 */
export async function saveContact(contact) {
  try {
    if (!contact || !contact.id) {
      throw new Error('Invalid contact object');
    }
    await setMapItem(ContactsStorageKeys.CONTACTS, contact.id, contact);
  } catch (error) {
    logError('contact-storage-save', error);
    throw error;
  }
}

/**
 * 删除联系人
 * @param {string} contactId
 * @returns {Promise<void>}
 */
export async function deleteContact(contactId) {
  try {
    await deleteMapItem(ContactsStorageKeys.CONTACTS, contactId);
  } catch (error) {
    logError('contact-storage-delete', error);
    throw error;
  }
}
