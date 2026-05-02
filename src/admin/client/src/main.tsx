import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

function App() {
  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Discord to QQ Bridge</p>
        <h1>DC-Bot 管理后台</h1>
        <p>项目骨架已就绪，后续阶段会接入状态、路由、队列和测试发送。</p>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
