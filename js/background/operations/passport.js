import { PassportClient } from '../passport-client.js';

function requireEndpoint(value) {
  const endpoint = String(value || '').trim();
  if (!endpoint) throw new Error('请输入 Node 服务地址');
  return endpoint;
}

function createClient({ endpoint, accessToken, fetchImpl } = {}) {
  return new PassportClient({
    endpoint: requireEndpoint(endpoint),
    getToken: () => String(accessToken || '').trim(),
    fetchImpl
  });
}

function success(payload) {
  return { success: true, ...payload };
}

function failure(error) {
  return {
    success: false,
    error: error?.message || 'Passport 请求失败',
    errorCode: error?.code || '',
    status: error?.status || 0
  };
}

export async function handleGetPassportStatus(data = {}, dependencies = {}) {
  try {
    const client = createClient({ ...data, fetchImpl: dependencies.fetchImpl });
    return success({ status: await client.getStatus() });
  } catch (error) {
    return failure(error);
  }
}

export async function handleCreatePassportBinding(data = {}, dependencies = {}) {
  try {
    const client = createClient({ ...data, fetchImpl: dependencies.fetchImpl });
    return success({ binding: await client.createBindingRequest() });
  } catch (error) {
    return failure(error);
  }
}

export async function handleGetPassportBindings(data = {}, dependencies = {}) {
  try {
    const client = createClient({ ...data, fetchImpl: dependencies.fetchImpl });
    return success({ bindings: await client.listBindings() });
  } catch (error) {
    return failure(error);
  }
}

export async function handleCreatePassportUnlink(data = {}, dependencies = {}) {
  try {
    const client = createClient({ ...data, fetchImpl: dependencies.fetchImpl });
    return success({ unlink: await client.createUnlinkRequest() });
  } catch (error) { return failure(error); }
}

export async function handleConfirmPassportUnlink(data = {}, dependencies = {}) {
  try {
    const client = createClient({ ...data, fetchImpl: dependencies.fetchImpl });
    return success({ unlink: await client.confirmUnlink(data) });
  } catch (error) { return failure(error); }
}

export async function handleApprovePassportAuthorization(data = {}, dependencies = {}) {
  try {
    const client = createClient({ ...data, fetchImpl: dependencies.fetchImpl });
    return success({ authorization: await client.approveAuthorization(data.requestId) });
  } catch (error) {
    return failure(error);
  }
}
