const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middleware/auth");
const {
  getPendingCount,
  getTicketOptions,
  listTickets,
  createTicket,
  resolveTicket,
  revokeTicket,
  cancelTicket,
} = require("../controller/tickets.controller");

router.use(verifyToken);

router.get("/pending-count", getPendingCount);
router.get("/options", getTicketOptions);
router.get("/", listTickets);
router.post("/", createTicket);
router.patch("/:id/resolve", resolveTicket);
router.delete("/:id", cancelTicket);
router.patch("/:id/revoke", revokeTicket);

module.exports = router;