const cors = require('cors');

app.use(cors({
  origin: ['https://secure-print-frontend.onrender.com', 'http://localhost:3000'],
  credentials: true
})); 