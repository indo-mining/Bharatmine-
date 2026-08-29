# Bharatmine-<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BharatMine</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      text-align: center;
      background: #f5f5f5;
      padding: 30px 15px;
    }
    .card {
      max-width: 400px;
      margin: auto;
      background: white;
      padding: 25px;
      border-radius: 20px;
      box-shadow: 0 4px 15px rgba(0,0,0,0.1);
    }
    h1 { margin-bottom: 10px; }
    .coin {
      font-size: 45px;
      margin: 20px;
    }
    .points {
      font-size: 30px;
      font-weight: bold;
      margin: 15px;
    }
    button {
      width: 100%;
      padding: 15px;
      border: 0;
      border-radius: 12px;
      background: #222;
      color: white;
      font-size: 17px;
      margin-top: 10px;
    }
  </style>
</head>
<body>

  <div class="card">
    <h1>🇮🇳 BharatMine</h1>
    <p>Mine daily • Complete tasks • Earn points</p>

    <div class="coin">🪙</div>

    <div class="points" id="points">0 Points</div>

    <button onclick="mine()">⛏️ Start Mining</button>
    <button onclick="task()">🎁 Daily Task</button>
    <button onclick="referral()">👥 Invite Friends</button>
  </div>

  <script>
    let points = Number(localStorage.getItem("points")) || 0;

    function update() {
      document.getElementById("points").innerText = points + " Points";
    }

    function mine() {
      points += 10;
      localStorage.setItem("points", points);
      update();
      alert("Mining started! +10 points");
    }

    function task() {
      points += 5;
      localStorage.setItem("points", points);
      update();
      alert("Daily task completed! +5 points");
    }

    function referral() {
      alert("Referral system coming soon!");
    }

    update();
  </script>

</body>
</html>
