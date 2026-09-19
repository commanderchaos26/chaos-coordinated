import { supabase } from './supabase';

function rpcErrorMessage(error: unknown) {
  const raw = typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message?: unknown }).message ?? '')
    : error instanceof Error
      ? error.message
      : String(error ?? '');
  const normalized = raw.toLowerCase();
  if (normalized.includes('property_name_already_exists')) {
    return 'An active property with that name already exists. Use a different property name or open the existing property.';
  }
  if (normalized.includes('property_archived')) {
    return 'This property is archived and cannot receive new work or client uploads.';
  }
  if (normalized.includes('insufficient_permission')) {
    return 'You do not have permission to perform this client-management action.';
  }
  return raw || 'The client request could not be completed.';
}

function throwRpcError(error: unknown): never {
  throw new Error(rpcErrorMessage(error));
}

type UploadDocumentInput = {
  companyId: string;
  clientId: string;
  propertyId: string;
  documentType: 'contract' | 'turn_list';
  uri: string;
  fileName: string;
  mimeType: string;
  byteSize?: number | null;
};

async function invoke(functionName: string, body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke(functionName, { body });
  if (error) throwRpcError(error);
  if (data?.error) throw new Error(data.message || data.error);
  return data;
}

export async function createClientWithProperty(params: {
  p_company_id: string;
  p_client_name: string;
  p_phone?: string | null;
  p_email?: string | null;
  p_property_name?: string | null;
  p_address_line1: string;
  p_city?: string | null;
  p_region?: string | null;
  p_postal_code?: string | null;
  p_country_code?: string | null;
}) {
  const { data, error } = await supabase.rpc('client_create_with_property', {
    p_phone: null,
    p_email: null,
    p_property_name: null,
    p_city: null,
    p_region: null,
    p_postal_code: null,
    p_country_code: 'US',
    ...params,
  });
  if (error) throwRpcError(error);
  return data as { ok: boolean; client: any; property: any };
}

export async function uploadClientDocument(input: UploadDocumentInput) {
  const prepared = await invoke('client-document', {
    action: 'prepare_upload',
    company_id: input.companyId,
    client_id: input.clientId,
    property_id: input.propertyId,
    document_type: input.documentType,
    file_name: input.fileName,
    mime_type: input.mimeType,
    byte_size: input.byteSize ?? null,
  }) as {
    document_id: string;
    bucket: string;
    path: string;
    token: string;
    version_no: number;
  };

  const response = await fetch(input.uri);
  if (!response.ok) throw new Error('Could not read the selected document from this device.');
  const bytes = await response.arrayBuffer();

  const { error: uploadError } = await supabase.storage
    .from(prepared.bucket)
    .uploadToSignedUrl(prepared.path, prepared.token, bytes, {
      contentType: input.mimeType,
      upsert: false,
    });
  if (uploadError) throw uploadError;

  const registered = await invoke('client-document', {
    action: 'register_upload',
    company_id: input.companyId,
    document_id: prepared.document_id,
  }) as { ok: boolean; document_id: string; import_id: string | null };

  return {
    ...registered,
    version_no: prepared.version_no,
  };
}

export async function getClientDocumentLink(companyId: string, documentId: string) {
  return invoke('client-document', {
    action: 'signed_read',
    company_id: companyId,
    document_id: documentId,
  }) as Promise<{ ok: boolean; file_name: string; signed_url: string; expires_in: number }>;
}

export async function scanTurnList(companyId: string, importId: string) {
  return invoke('scan-turn-list', {
    company_id: companyId,
    import_id: importId,
  }) as Promise<{
    ok: boolean;
    import_id: string;
    total_items: number;
    needs_review_count: number;
    items: any[];
  }>;
}

export async function commitTurnListImport(companyId: string, importId: string) {
  const { data, error } = await supabase.rpc('client_commit_turn_list_import', {
    p_company_id: companyId,
    p_import_id: importId,
  });
  if (error) throwRpcError(error);
  return data as { ok: boolean; pending_count: number; needs_review_count: number };
}

export async function correctTurnListItem(companyId: string, itemId: string, buildingLabel: string, unitNumber: string) {
  const { data, error } = await supabase.rpc('client_update_turn_list_item', {
    p_company_id: companyId,
    p_item_id: itemId,
    p_building_label: buildingLabel,
    p_unit_number: unitNumber,
  });
  if (error) throwRpcError(error);
  return data;
}

export async function markTurnListItemProcessed(companyId: string, itemId: string, sessionId: string) {
  const { data, error } = await supabase.rpc('turn_list_mark_processed', {
    p_company_id: companyId,
    p_item_id: itemId,
    p_session_id: sessionId,
  });
  if (error) throwRpcError(error);
  return data;
}
