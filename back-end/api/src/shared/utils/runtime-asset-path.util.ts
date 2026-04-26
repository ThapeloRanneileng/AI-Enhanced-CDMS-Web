import * as fs from 'node:fs';
import * as path from 'node:path';

export function resolveRuntimeAssetPath(currentDir: string, ...assetPathSegments: string[]): string {
    const relativeAssetPath = path.join(...assetPathSegments);
    const normalizedCurrentDir = path.normalize(currentDir);
    const cwd = process.cwd();

    const candidates = [
        path.join(normalizedCurrentDir, relativeAssetPath),
        path.join(
            normalizedCurrentDir.replace(
                `${path.sep}dist${path.sep}src${path.sep}`,
                `${path.sep}dist${path.sep}`,
            ),
            relativeAssetPath,
        ),
        path.join(
            normalizedCurrentDir.replace(
                `${path.sep}dist${path.sep}src${path.sep}`,
                `${path.sep}src${path.sep}`,
            ),
            relativeAssetPath,
        ),
        path.join(
            cwd,
            'dist',
            path.relative(path.join(cwd, 'dist', 'src'), normalizedCurrentDir),
            relativeAssetPath,
        ),
        path.join(
            cwd,
            'src',
            path.relative(path.join(cwd, 'dist', 'src'), normalizedCurrentDir),
            relativeAssetPath,
        ),
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return candidates[0];
}
