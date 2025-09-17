import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import User from "./pages/User.jsx";
import Login from "./pages/Login.jsx";
import Signup from "./pages/Signup.jsx";
import Dashboard from "./pages/Dashboard.jsx";

function App() {

  return (
      <Router>
          <Routes>
              {/* Route for the Login page */}
              <Route path="/login" element={<Login />} />

              {/* Route for the Signup page */}
              <Route path="/signup" element={<Signup />} />

              {/* Default route to login page if none of the above matches */}
              <Route path="/home" element={<User />} />
              <Route path="/admin" element={<Dashboard />} />
          </Routes>
      </Router>
  )
}

export default App
