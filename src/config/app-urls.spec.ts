import {
  resolveApiPublicUrl,
  resolveClientUrl,
} from './app-urls';

describe('app-urls', () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
    delete process.env.CLIENT_URL;
    delete process.env.FRONTEND_URL;
    delete process.env.API_PUBLIC_URL;
    delete process.env.RENDER_EXTERNAL_URL;
    delete process.env.RENDER;
    delete process.env.NODE_ENV;
    delete process.env.PORT;
  });

  afterAll(() => {
    process.env = env;
  });

  it('uses localhost defaults in local development', () => {
    expect(resolveClientUrl()).toBe('http://localhost:3000');
    expect(resolveApiPublicUrl()).toBe('http://localhost:4000');
  });

  it('prefers configured client and api urls', () => {
    process.env.CLIENT_URL = 'https://dev.relistedlabels.com/';
    process.env.API_PUBLIC_URL = 'https://relisted-backend.onrender.com/';
    expect(resolveClientUrl()).toBe('https://dev.relistedlabels.com');
    expect(resolveApiPublicUrl()).toBe('https://relisted-backend.onrender.com');
  });

  it('uses render external url for api links on hosted environments', () => {
    process.env.RENDER = 'true';
    process.env.RENDER_EXTERNAL_URL =
      'https://relisted-backend.onrender.com';
    expect(resolveApiPublicUrl()).toBe('https://relisted-backend.onrender.com');
  });

  it('does not fall back to localhost on hosted environments', () => {
    process.env.RENDER = 'true';
    expect(resolveClientUrl()).toBe('');
    expect(resolveApiPublicUrl()).toBe('');
  });
});
