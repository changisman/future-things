# 미래 물건 상상 놀이터

초등 3학년이 현재 물건을 보고 챗봇과 이야기한 뒤, "바뀌지 않아야 할 쓰임새"와 "바뀌면 좋을 점"을 쓰면 미래 물건 그림을 만들어 주는 웹앱입니다.

## 기능

1. 학생 이름 입력
2. `이미지/` 폴더의 물건 중 하나를 무작위로 보여줌 (어려우면 다른 물건으로 바꾸기)
3. 미래 탐험 로봇(챗봇)과 대화: 쓰임새 → 꼭 지켜야 할 쓰임새 → 불편한 점 → 바뀌면 좋을 점 순서로 안내하고, 주제에서 벗어나면 다시 돌아오게 함
4. 바뀌지 않아야 할 쓰임새 / 바뀌면 좋을 점 쓰기
5. 쓴 내용으로 미래 물건 그림 만들기
6. 친구들 작품 모아 보기

## 실행 방법

1. Gemini API 키 발급: https://aistudio.google.com/apikey
2. `.env.example` 을 `.env` 로 복사하고 `GEMINI_API_KEY=` 뒤에 키를 넣습니다.
   (Finder에서 `.env` 가 안 보이면 `⌘ + Shift + .` 을 누르세요.)
3. 터미널에서:
   ```
   cd 미래물건
   npm install
   npm start
   ```
4. 브라우저에서 http://localhost:3000 접속
   - 같은 와이파이의 학생 기기에서는 `http://<선생님 컴퓨터 IP>:3000`

## 인터넷에 올리기 (Render + Neon, 무료)

1. **Neon**(작품 보관용 무료 데이터베이스): https://neon.tech 가입 → 프로젝트 만들기 → 연결 주소(`postgresql://...`) 복사
2. **Render**: https://render.com 에 GitHub 계정으로 가입 → **New → Blueprint** → 이 저장소 선택
3. 입력 칸에 값 넣기
   - `GEMINI_API_KEY`: 제미나이 키
   - `DATABASE_URL`: Neon 연결 주소
   - `CLASS_PASSWORD`: 학생들이 입력할 반 비밀번호 (비워 두면 비밀번호 없이 접속)
4. 배포가 끝나면 `https://future-things-xxxx.onrender.com` 같은 주소로 접속합니다.
   - 무료 요금제는 15분 동안 접속이 없으면 잠들어서, 첫 접속에 1분 정도 걸릴 수 있습니다.
   - GitHub에 새 코드를 올리면 자동으로 다시 배포됩니다.

`DATABASE_URL` 이 없으면 작품은 `작품/` 폴더에 저장됩니다(컴퓨터에서 실행할 때).

## 모델과 그림 방식

- 챗봇: Gemini lite 모델 (빠름). `ANTHROPIC_API_KEY` 를 넣고 `CHAT_PROVIDER=claude` 로 Claude를 쓸 수도 있습니다.
- 그림: 기본은 **무료 SVG 그림** — 챗봇 모델이 도형으로 그림을 그립니다(약 1분).
  - 결제한 Gemini 키가 있으면 `IMAGE_PROVIDER=gemini`, OpenAI 키가 있으면 `OPENAI_API_KEY` 로 사진 같은 그림을 만들 수 있습니다.

## 폴더

- `이미지/` : 보여줄 현재 물건 사진. 파일 이름이 곧 물건 이름이 됩니다(예: `연필.png`).
- `작품/` : 학생들이 만든 그림과 `gallery.json` (git에는 올라가지 않음). 작품을 지우려면 이 폴더에서 파일과 json 항목을 삭제하세요.
- `server.js` : 서버, 챗봇, 그림 생성
- `storage.js` : 작품 저장 (데이터베이스 또는 폴더)
- `render.yaml` : Render 배포 설정
- `public/` : 학생 화면
