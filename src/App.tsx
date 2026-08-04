import { SubtitleEditor } from "./features/subtitles/SubtitleEditor";
import "./App.css";

// Provisorischer Einstiegspunkt für den feature/subtitles-Branch.
// Wird beim Merge mit feature/video-editing durch eine echte App-Shell/Navigation ersetzt.
function App() {
  return (
    <main className="container">
      <SubtitleEditor />
    </main>
  );
}

export default App;
