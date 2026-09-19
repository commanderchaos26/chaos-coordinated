import * as Crypto from 'expo-crypto';
import { supabase } from './supabase';

export type CompletionEvidence = {
  id: string;
  signedUrl: string;
  mimeType: string | null;
  byteSize: number | null;
  capturedAt: string;
};

type PrepareResult = {
  ok: boolean;
  bucket: string;
  path: string;
  token?: string | null;
  upload_required?: boolean;
  already_registered?: boolean;
  evidence_file_id?: string | null;
};

async function invoke(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('work-evidence', { body });
  if (error) throw error;
  if (data?.error) throw new Error(data.message || data.error);
  return data;
}

function bytesToHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

export async function getCompletionEvidence(params: {
  companyId: string;
  assignmentId: string;
  workOrderId: string;
}) {
  const data = await invoke({
    action: 'list_completion',
    company_id: params.companyId,
    assignment_id: params.assignmentId,
    work_order_id: params.workOrderId,
  }) as { ok: boolean; evidence: CompletionEvidence[] };

  return data.evidence ?? [];
}

export async function uploadCompletionPhoto(params: {
  companyId: string;
  assignmentId: string;
  workOrderId: string;
  uri: string;
  mimeType?: string | null;
  byteSize?: number | null;
}) {
  const mimeType = params.mimeType || 'image/jpeg';

  const response = await fetch(params.uri);
  if (!response.ok) throw new Error('Could not read the completion photo from this device.');
  const body = await response.arrayBuffer();
  const digest = await Crypto.digest(
    Crypto.CryptoDigestAlgorithm.SHA256,
    new Uint8Array(body),
  );
  const sha256 = bytesToHex(digest);

  const prepared = await invoke({
    action: 'prepare_upload',
    company_id: params.companyId,
    assignment_id: params.assignmentId,
    work_order_id: params.workOrderId,
    mime_type: mimeType,
    sha256,
  }) as PrepareResult;

  if (prepared.already_registered && prepared.evidence_file_id) {
    return {
      ok: true,
      evidence_file_id: prepared.evidence_file_id,
      already_registered: true,
    };
  }

  if (prepared.upload_required !== false) {
    if (!prepared.token) throw new Error('Could not create completion-photo upload token.');
    const { error: uploadError } = await supabase.storage
      .from(prepared.bucket)
      .uploadToSignedUrl(prepared.path, prepared.token, body, {
        contentType: mimeType,
        upsert: false,
      });
    if (uploadError) throw uploadError;
  }

  return invoke({
    action: 'register_upload',
    company_id: params.companyId,
    assignment_id: params.assignmentId,
    work_order_id: params.workOrderId,
    storage_path: prepared.path,
    mime_type: mimeType,
    byte_size: params.byteSize ?? body.byteLength,
    sha256,
  });
}
