# UCI 전력 데이터 준비

이 폴더는 데이터 출처와 준비 방법을 안내한다. **원본 텍스트와 DB 데이터는 저장소에 포함되어 있지 않으며 각자 준비·입력한다.**

원본 텍스트는 132,960,755바이트이므로 저장소에 포함하지 않는다. 프로젝트 폴더에서 Python 3.11 이상으로 다음 명령을 실행한다.

```powershell
python scripts/download_data.py
```

공식 UCI ZIP을 받아 압축 파일과 추출된 텍스트의 SHA-256을 검사한다. 기존 파일이 있으면 해시만 확인하며 덮어쓰지 않는다. 직접 받은 원본을 이 폴더의 `household_power_consumption.txt`로 두어도 된다.

예상 SHA-256:

```text
4259c9d7ece5dbee9ab8d53682baac68d791c864f0f64a52b4043cb3b90894b7
```

출처: Hebrail, G. & Berard, A. (2006), [Individual Household Electric Power Consumption](https://archive.ics.uci.edu/dataset/235/individual+household+electric+power+consumption), UCI Machine Learning Repository, [DOI](https://doi.org/10.24432/C58K54), CC BY 4.0.

`download-metadata.json`은 개발 시 확인한 원본의 행 수·해시·출처 기록이다. 현재 사용자의 다운로드 완료나 DB 적재 완료를 의미하지 않는다.

파일을 받은 뒤 완성된 앱을 실행하려면 [README](../README.md)의 DB 설정 → `profile.py` → `load.ps1` → `verify.js` → 앱 실행 순서를 따른다. 다운로드만으로 DB에 입력되지는 않는다.

Codex와 직접 개발하려면 준비한 원본과 AGENTS.md를 새 작업 폴더에 복사하고 [직접 개발 안내](../docs/BUILD_WITH_CODEX.md)를 따른다.
