"""Download the original UCI archive and preserve the extracted text bytes.

Uses only Python's standard library. Existing files are verified, never replaced.
"""
from pathlib import Path
import argparse
import hashlib
import os
import shutil
import tempfile
import urllib.request
import zipfile

URL = 'https://archive.ics.uci.edu/static/public/235/individual%2Bhousehold%2Belectric%2Bpower%2Bconsumption.zip'
ARCHIVE_SHA256 = '9f84b46ade8a2d8e1286ec4b2b6c2987a45a755c59f263be3b3b3d10dfbda3ff'
TEXT_SHA256 = '4259c9d7ece5dbee9ab8d53682baac68d791c864f0f64a52b4043cb3b90894b7'
TEXT_NAME = 'household_power_consumption.txt'

def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def download(data_dir):
    data_dir = data_dir.resolve()
    target = data_dir / TEXT_NAME
    if target.exists():
        if digest(target) != TEXT_SHA256:
            raise FileExistsError('Existing source has a different SHA-256; it was not changed: ' + str(target))
        print('VERIFIED existing source; no download or overwrite: ' + str(target))
        return target
    data_dir.mkdir(parents=True, exist_ok=True)
    # Temporary files stay in the selected data folder and are owned by this run.
    with tempfile.TemporaryDirectory(prefix='.uci-download-', dir=data_dir) as temp:
        temporary = Path(temp)
        archive = temporary / 'source.zip'
        with urllib.request.urlopen(URL, timeout=30) as response, archive.open('xb') as output:
            shutil.copyfileobj(response, output)
        if digest(archive) != ARCHIVE_SHA256:
            raise ValueError('Downloaded archive SHA-256 does not match the verified UCI archive')
        extracted = temporary / TEXT_NAME
        with zipfile.ZipFile(archive) as zipped:
            # Extract only this exact member, avoiding archive-controlled paths.
            with zipped.open(TEXT_NAME) as source, extracted.open('xb') as output:
                shutil.copyfileobj(source, output)
        if digest(extracted) != TEXT_SHA256:
            raise ValueError('Extracted source SHA-256 mismatch')
        try:
            # Exclusive creation prevents overwriting a file created during download.
            with target.open('xb') as output:
                try:
                    with extracted.open('rb') as source:
                        shutil.copyfileobj(source, output)
                    output.flush()
                    os.fsync(output.fileno())
                except BaseException:
                    # A partial source is intentionally retained for inspection.
                    raise
        except FileExistsError:
            raise FileExistsError('Source appeared during download; it was not overwritten') from None
    print('DOWNLOADED and VERIFIED: ' + str(target))
    return target

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', type=Path, default=Path(__file__).resolve().parents[1] / 'data')
    arguments = parser.parse_args()
    download(arguments.data_dir)
