import * as fs from 'node:fs';
import * as path from 'node:path';

describe('ObservationAnomalyTrainingController', () => {
  it('protects all anomaly training endpoints with the admin guard', () => {
    const controllerSource = fs.readFileSync(
      path.join(__dirname, 'observation-anomaly-training.controller.ts'),
      'utf8',
    );

    expect(controllerSource).toContain("import { Admin } from 'src/user/decorators/admin.decorator';");
    expect(controllerSource).toMatch(/@Admin\(\)\s*@Controller\('observation-ai\/training'\)/);
  });
});
