jest.mock('../config', () => ({
  __esModule: true,
  default: {
    storage: {
      accessKeyId: 'your-oci-access-key-id',
      secretAccessKey: 'secret',
      bucket: 'test-bucket',
      endpoint: 'https://example.com',
      region: 'us-ashburn-1',
      signedUrlExpiresSeconds: 3600,
    },
  },
}));

jest.mock('../lib/s3', () => ({
  __esModule: true,
  default: { send: jest.fn() },
}));

import { usesLocalStorage, getMediaSignedUrl } from '../services/storageService';

describe('storageService', () => {
  it('usesLocalStorage detects placeholder OCI credentials', () => {
    expect(usesLocalStorage()).toBe(true);
  });

  it('getMediaSignedUrl returns same-origin path for local storage', async () => {
    const url = await getMediaSignedUrl('jobs/job-1/media/photo.jpg');
    expect(url).toBe('/uploads/jobs/job-1/media/photo.jpg');
  });

  it('getMediaSignedUrl appends download query for local storage', async () => {
    const url = await getMediaSignedUrl('jobs/job-1/media/photo.jpg', true);
    expect(url).toBe('/uploads/jobs/job-1/media/photo.jpg?download=true');
  });
});
