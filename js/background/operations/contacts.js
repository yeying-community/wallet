/**
 * YeYing Wallet - 联系人操作
 * 负责：联系人增删改查
 */
import { validateContactName, validateEthereumAddress } from '../../config/validation-rules.js';
import {
  getContactList,
  getContact,
  saveContact,
  deleteContact
} from '../../storage/index.js';

function normalizeContactAddress(address) {
  return String(address || '').trim();
}

function createContactId() {
  const random = Math.random().toString(36).slice(2, 8);
  return `contact_${Date.now()}_${random}`;
}

function findDuplicateContact(contacts, address, excludeId = null) {
  const normalized = String(address || '').toLowerCase();
  if (!normalized) return null;
  return contacts.find(contact => {
    if (!contact) return false;
    if (excludeId && contact.id === excludeId) return false;
    const existing = String(contact.address || '').toLowerCase();
    return existing === normalized;
  });
}

export async function handleGetContacts() {
  try {
    const contacts = await getContactList();
    contacts.sort((a, b) => (a?.name || '').localeCompare(b?.name || '', 'zh-CN'));
    return { success: true, contacts };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to get contacts' };
  }
}

export async function handleAddContact(data = {}) {
  const name = String(data?.name || '').trim();
  const address = normalizeContactAddress(data?.address);
  const note = String(data?.note || '').trim();

  const nameValidation = validateContactName(name);
  if (!nameValidation.valid) {
    return { success: false, error: nameValidation.error || 'Invalid contact name' };
  }

  const addressValidation = validateEthereumAddress(address);
  if (!addressValidation.valid) {
    return { success: false, error: addressValidation.error || 'Invalid address' };
  }

  try {
    const contacts = await getContactList();
    const duplicate = findDuplicateContact(contacts, address);
    if (duplicate) {
      return { success: false, error: '该地址已存在于联系人中' };
    }

    const now = Date.now();
    const contact = {
      id: createContactId(),
      name,
      address,
      note,
      createdAt: now,
      updatedAt: now
    };

    await saveContact(contact);
    return { success: true, contact };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to add contact' };
  }
}

export async function handleUpdateContact(data = {}) {
  const contactId = String(data?.id || '').trim();
  if (!contactId) {
    return { success: false, error: 'contactId is required' };
  }

  const existing = await getContact(contactId);
  if (!existing) {
    return { success: false, error: 'Contact not found' };
  }

  const name = data?.name != null ? String(data.name).trim() : existing.name;
  const address = data?.address != null ? normalizeContactAddress(data.address) : existing.address;
  const note = data?.note != null ? String(data.note).trim() : existing.note || '';

  const nameValidation = validateContactName(name);
  if (!nameValidation.valid) {
    return { success: false, error: nameValidation.error || 'Invalid contact name' };
  }

  const addressValidation = validateEthereumAddress(address);
  if (!addressValidation.valid) {
    return { success: false, error: addressValidation.error || 'Invalid address' };
  }

  try {
    const contacts = await getContactList();
    const duplicate = findDuplicateContact(contacts, address, contactId);
    if (duplicate) {
      return { success: false, error: '该地址已存在于联系人中' };
    }

    const updated = {
      ...existing,
      name,
      address,
      note,
      updatedAt: Date.now()
    };

    await saveContact(updated);
    return { success: true, contact: updated };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to update contact' };
  }
}

export async function handleDeleteContact(contactId) {
  if (!contactId) {
    return { success: false, error: 'contactId is required' };
  }
  try {
    await deleteContact(contactId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to delete contact' };
  }
}
