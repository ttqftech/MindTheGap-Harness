import { render } from "solid-js/web";
import App from "./App";
import { state, actions } from "./store";
import "./styles/global.css";
import "./theme/theme.css";

// dev-only debug exposure
(window as any).__store = { state, actions };

render(() => <App />, document.getElementById("root")!);
