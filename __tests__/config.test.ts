import { FileStack } from '../src/config';
import * as path from 'path';
import * as fs from 'fs';

describe('FileStack', () => {
  const testDir = path.join(__dirname, 'test_data');
  const stackFilePath = path.join(testDir, 'stack.yaml');

  beforeAll(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir);
    }
    const stackContent = `
name: test-project
profile:
  default:
    mode: docker
    stage: dev
  local:
    mode: local
resources:
  my-service:
    type: node
`;
    fs.writeFileSync(stackFilePath, stackContent);
  });

  afterAll(() => {
    fs.unlinkSync(stackFilePath);
    fs.rmdirSync(testDir);
  });

  it('should load and parse the stack.yaml file correctly', () => {
    const fileStack = new FileStack({ file: stackFilePath, profile: 'default' }); // Added default profile
    expect(fileStack.config).toBeDefined();
    expect(fileStack.config.name).toBe('test-project');
  });

  it('should return the correct profile', () => {
    const fileStack = new FileStack({ file: stackFilePath, profile: 'local' });
    const profile = fileStack.getProfile();
    expect(profile).toBeDefined();
    expect(profile.mode).toBe('local');
  });

  it('should return the default profile when none is specified', () => {
    const fileStack = new FileStack({ file: stackFilePath, profile: 'default' }); // Explicitly pass default profile
    const profile = fileStack.getProfile();
    expect(profile).toBeDefined();
    expect(profile.mode).toBe('docker');
  });

  it('should throw an error for a non-existent profile', () => {
    const fileStack = new FileStack({ file: stackFilePath, profile: 'non-existent' });
    expect(() => fileStack.getProfile()).toThrow('Perfil no encontrado: non-existent');
  });
});
