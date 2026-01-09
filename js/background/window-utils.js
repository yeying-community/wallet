/**
 * YeYing Wallet - 窗口位置工具
 * 负责：复用 popup 位置作为弹窗锚点
 */

import { state } from './state.js';
import { getUserSetting } from '../storage/index.js';

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return value;
  if (Number.isFinite(min) && value < min) return min;
  if (Number.isFinite(max) && value > max) return max;
  return value;
}

export function normalizePopupBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') {
    return null;
  }

  const normalized = {};
  const screenInfo = bounds.screen || {};

  if (typeof bounds.left === 'number') {
    normalized.left = bounds.left;
  }

  if (typeof bounds.top === 'number') {
    normalized.top = bounds.top;
  }

  if (
    typeof screenInfo.availLeft === 'number' &&
    typeof screenInfo.availTop === 'number' &&
    typeof screenInfo.availWidth === 'number' &&
    typeof screenInfo.availHeight === 'number'
  ) {
    normalized.screen = {
      availLeft: screenInfo.availLeft,
      availTop: screenInfo.availTop,
      availWidth: screenInfo.availWidth,
      availHeight: screenInfo.availHeight
    };
  }

  if (!normalized.screen) {
    // 没有屏幕信息时避免使用过期的 left/top
    delete normalized.left;
    delete normalized.top;
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

let popupBoundsLoading = null;

export async function ensurePopupBoundsLoaded() {
  if (state.popupBounds) {
    return state.popupBounds;
  }

  if (popupBoundsLoading) {
    return popupBoundsLoading;
  }

  popupBoundsLoading = (async () => {
    const saved = await getUserSetting('popupBounds', null);
    const normalized = normalizePopupBounds(saved);
    if (normalized) {
      state.popupBounds = normalized;
      return normalized;
    }
    return null;
  })();

  try {
    return await popupBoundsLoading;
  } finally {
    popupBoundsLoading = null;
  }
}

export async function withPopupBoundsAsync(options) {
  await ensurePopupBoundsLoaded();
  return withPopupBounds(options);
}

export function withPopupBounds(options) {
  const bounds = normalizePopupBounds(state.popupBounds);
  if (!bounds) {
    return options;
  }

  const merged = { ...options };

  if (typeof bounds.left === 'number') {
    let left = bounds.left;
    if (bounds.screen && typeof merged.width === 'number') {
      const halfWidth = merged.width / 2;
      const minLeft = bounds.screen.availLeft - halfWidth;
      const maxLeft = bounds.screen.availLeft + bounds.screen.availWidth - halfWidth;
      left = clamp(left, minLeft, maxLeft);
    }
    merged.left = left;
  }

  if (typeof bounds.top === 'number') {
    let top = bounds.top;
    if (bounds.screen && typeof merged.height === 'number') {
      const halfHeight = merged.height / 2;
      const minTop = bounds.screen.availTop - halfHeight;
      const maxTop = bounds.screen.availTop + bounds.screen.availHeight - halfHeight;
      top = clamp(top, minTop, maxTop);
    }
    merged.top = top;
  }

  return merged;
}
