import { getUrlPolicyError } from './safe-fetch.js';

export function classifyExtractInitialError(error) {
  const policyError = getUrlPolicyError(error);
  if (policyError?.code === 'INVALID_URL') {
    return { status: 400, message: 'invalid url' };
  }
  if (policyError) return { status: 403, message: 'url not allowed' };
  return { status: 400, message: 'invalid url' };
}

export function classifyExtractRuntimeError(error) {
  if (getUrlPolicyError(error)) {
    return { status: 403, message: 'url not allowed' };
  }
  return { status: 500, message: 'extract failed' };
}

export function classifyStreamTargetError(error) {
  const policyError = getUrlPolicyError(error);
  if (policyError?.code === 'INVALID_PROXY_TARGET') {
    return { status: 400, message: 'invalid sub-resource url' };
  }
  if (
    policyError?.code === 'PROXY_TARGET_NOT_ALLOWED' ||
    policyError?.code === 'BLOCKED_ADDRESS' ||
    policyError?.code === 'INVALID_URL'
  ) {
    return { status: 403, message: 'sub-resource url not allowed' };
  }
  return { status: 502, message: 'upstream unavailable' };
}
