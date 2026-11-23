# LocalDrop (PairDrop方式)

```
npm install
npm start      # http://localhost:3000
```

## 機能
- 同じネットワークの端末は自動で表示(同じ公開IP / LAN内)
- 別ネットワークとは「ペア(6桁・永続)」か「公開ルーム(5文字・一時)」でつなぐ。QRコードにも対応
- 通信は WebRTC で直接。つながらない場合はサーバー経由(WebSocket中継)に自動切替
- 複数ファイル送信(受信側でZIP保存可)、ドラッグ&ドロップ(端末の上へ)、貼り付け送信
- 通知、PWAインストール、他アプリからの「共有」受け取り(HTTPS環境で有効)
- ペア解除は、相手がオフラインでも次回接続時に伝わる(サーバー再起動までの間)

## Render
このフォルダをGitHubに置き、Web Service で Build=`npm install` / Start=`npm start` (render.yaml 同梱)。
PWA・通知・共有にはHTTPSが必要です(Renderでは自動)。
