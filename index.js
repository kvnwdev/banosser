import "dotenv/config";
import React from "react";
import { render, Text, Box, useApp, useInput } from "ink";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

// Ensure required directories exist before anything runs
const projectRoot = process.cwd();
const workingDir = path.resolve(projectRoot, "working");
const finalDir = path.resolve(projectRoot, "final");
if (!fs.existsSync(workingDir)) fs.mkdirSync(workingDir, { recursive: true });
if (!fs.existsSync(finalDir)) fs.mkdirSync(finalDir, { recursive: true });

function runScript(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: true });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

function MenuItem(props) {
  const { label, isSelected } = props;
  return React.createElement(
    Text,
    { color: isSelected ? "green" : undefined },
    isSelected ? "› " : "  ",
    label
  );
}

function App() {
  const { exit } = useApp();
  const options = [
    { id: "openrouter", label: "Use OpenRouter (process:images:openrouter)" },
    { id: "google", label: "Use Google GenAI SDK (process:images)" },
    { id: "quit", label: "Quit" },
  ];
  const [index, setIndex] = React.useState(0);
  const [status, setStatus] = React.useState("Choose backend and press Enter");
  const [running, setRunning] = React.useState(false);
  const [askLimit, setAskLimit] = React.useState(false);
  const [limitInput, setLimitInput] = React.useState("");

  const onEnter = async () => {
    if (running) return;
    const choice = options[index].id;
    if (choice === "quit") {
      exit();
      return;
    }
    // prompt for limit first
    setAskLimit(true);
  };

  useInput((input, key) => {
    if (askLimit) {
      if (key.return) {
        const choice = options[index].id;
        const trimmed = limitInput.trim();
        const args = trimmed ? ["--limit", trimmed] : [];
        (async () => {
          setRunning(true);
          setAskLimit(false);
          try {
            if (choice === "openrouter") {
              setStatus("Running OpenRouter image processing...");
              await runScript("pnpm", ["run", "process:images:openrouter", ...args]);
            } else if (choice === "google") {
              setStatus("Running Google GenAI SDK image processing...");
              await runScript("pnpm", ["run", "process:images", ...args]);
            }
            setStatus("Done. See ./final for outputs.");
          } catch (e) {
            setStatus(`Error: ${e.message}`);
          } finally {
            setRunning(false);
            setLimitInput("");
          }
        })();
      } else if (key.backspace || key.delete) {
        setLimitInput((s) => s.slice(0, -1));
      } else if (/^[0-9]$/.test(input)) {
        setLimitInput((s) => (s.length < 6 ? s + input : s));
      } else if (key.escape) {
        setAskLimit(false);
        setLimitInput("");
      }
      return;
    }

    if (key.upArrow) setIndex((i) => (i > 0 ? i - 1 : options.length - 1));
    else if (key.downArrow) setIndex((i) => (i + 1) % options.length);
    else if (key.return) onEnter();
  });

  return React.createElement(
    Box,
    { flexDirection: "column" },
    React.createElement(
      Box,
      { marginBottom: 1 },
      React.createElement(Text, null, status)
    ),
    ...(askLimit
      ? [
          React.createElement(
            Text,
            { key: "prompt" },
            "Batch size (press Enter for all): ",
            limitInput || ""
          ),
        ]
      : options.map((opt, i) =>
          React.createElement(MenuItem, {
            key: opt.id,
            label: opt.label,
            isSelected: i === index,
          })
        )
    ),
    React.createElement(
      Box,
      { marginTop: 1 },
      React.createElement(
        Text,
        { dimColor: true },
        askLimit
          ? "Type a number (optional). Enter to start. Esc to cancel."
          : "Use ↑/↓ to navigate, Enter to confirm."
      )
    )
  );
}

render(React.createElement(App));