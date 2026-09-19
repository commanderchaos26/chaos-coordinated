import { supabase } from './supabase';

type PrepareResult = {
  ok: boolean;
  bucket: string;
  path: string;
  token: string;
};

async function invoke(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('work-evidence', { body });
  if (error) throw error;
  if (data?.error) throw new Error(data.message || data.error);
  return data;
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
  const prepared = await invoke({
    action: 'prepare_upload',
    company_id: params.companyId,
    assignment_id: params.assignmentId,
    work_order_id: params.workOrderId,
    mime_type: mimeType,
  }) as PrepareResult;

  const response = await fetch(params.uri);
  if (!response.ok) throw new Error('Could not read the completion photo from this device.');
  const body = await response.arrayBuffer();

  const { error: uploadError } = await supabase.storage
    .from(prepared.bucket)
    .uploadToSignedUrl(prepared.path, prepared.token, body, {
      contentType: mimeType,
      upsert: false,
    });
  if (uploadError) throw uploadError;

  return invoke({
    action: 'register_upload',
    company_id: params.companyId,
    assignment_id: params.assignmentId,
    work_order_id: params.workOrderId,
    storage_path: prepared.path,
    mime_type: mimeType,
    byte_size: params.byteSize ?? body.byteLength,
  });
}
