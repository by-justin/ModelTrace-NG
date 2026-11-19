import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createHashRouter, RouterProvider } from "react-router-dom";
import "./i18n";
import "./styles.css";
import { Layout } from "./components/Layout";
import { MethodPage } from "./pages/MethodPage";
import { ModelsPage } from "./pages/ModelsPage";
import { ResultPage } from "./pages/ResultPage";
import { TestPage } from "./pages/TestPage";
import { AppProvider } from "./state";

// Hash routing keeps the site fully static (GitHub Pages has no rewrite rules).
const router = createHashRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <TestPage /> },
      { path: "/result", element: <ResultPage /> },
      { path: "/models", element: <ModelsPage /> },
      { path: "/method", element: <MethodPage /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProvider>
      <RouterProvider router={router} />
    </AppProvider>
  </StrictMode>,
);
