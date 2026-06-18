import type { Organization, OrganizationAddress, OrganizationRequest, UpdateOrganizationRequest } from '../../api/endpoints';

export const getOrganizationId = (organization: Organization) => Number((organization as any).id ?? (organization as any).organizationId ?? 0);

export const getOrganizationStatus = (status: Organization['status']) => (status === true || status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE');

export const emptyOrganizationAddress: OrganizationAddress = {
  addressLine1: '',
  addressLine2: '',
  city: '',
  stateId: 0,
  countryId: 0,
  pincode: '',
};

export const emptyOrganizationForm: UpdateOrganizationRequest = {
  name: '',
  description: '',
  logoUrl: '',
  address: emptyOrganizationAddress,
  status: 'ACTIVE',
};

export const normalizeOrganizationAddress = (address: Organization['address']): OrganizationAddress => {
  if (!address) return { ...emptyOrganizationAddress };
  if (typeof address === 'string') return { ...emptyOrganizationAddress, addressLine1: address };

  return {
    addressLine1: address.addressLine1 || '',
    addressLine2: address.addressLine2 || '',
    city: address.city || '',
    stateId: Number(address.stateId || 0),
    countryId: Number(address.countryId || 0),
    pincode: address.pincode || '',
    stateName: address.stateName,
    countryName: address.countryName,
  };
};

export const formatOrganizationAddress = (address: Organization['address']) => {
  if (!address) return 'N/A';
  if (typeof address === 'string') return address || 'N/A';

  return [
    address.addressLine1,
    address.addressLine2,
    address.city,
    address.stateName,
    address.countryName,
    address.pincode,
  ].filter(Boolean).join(', ') || 'N/A';
};

export const toOrganizationAddressRequest = (address: OrganizationAddress): OrganizationAddress => ({
  addressLine1: address.addressLine1 || '',
  addressLine2: address.addressLine2 || '',
  city: address.city || '',
  stateId: Number(address.stateId || 0),
  countryId: Number(address.countryId || 0),
  pincode: address.pincode || '',
});

export const toCreateOrganizationRequest = ({ logoUrl: _logoUrl, ...form }: UpdateOrganizationRequest): OrganizationRequest => ({
  ...form,
  address: toOrganizationAddressRequest(form.address),
});

export const toUpdateOrganizationRequest = (organization: Organization, logoUrl: string): UpdateOrganizationRequest => ({
  name: organization.name || '',
  description: organization.description || '',
  logoUrl,
  address: toOrganizationAddressRequest(normalizeOrganizationAddress(organization.address)),
  status: getOrganizationStatus(organization.status),
});

const extractLogoUrl = (value: unknown): string => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return '';

  const response = value as Record<string, unknown>;
  const directValue = response.logoUrl || response.url || response.fileUrl || response.filePath || response.path;
  if (typeof directValue === 'string') return directValue;
  return extractLogoUrl(response.data);
};

export const getUploadedOrganizationLogoUrl = (response: unknown) => extractLogoUrl(response);
