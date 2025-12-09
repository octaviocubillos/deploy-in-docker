
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

describe('ps command (e2e)', () => {
  it('should list containers', async () => {
    const { stdout, stderr } = await execAsync('ts-node src/index.ts ps');

    expect(stderr).toBe('');
    expect(stdout).toContain('ID');
    expect(stdout).toContain('Nombre');
    expect(stdout).toContain('Imagen');
    expect(stdout).toContain('Estado');
    expect(stdout).toContain('Status');
  });
});
