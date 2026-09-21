from __future__ import annotations
from dataclasses import dataclass, asdict
from datetime import date, datetime, timedelta
from threading import Lock
from uuid import uuid4 
import re 
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

# default date nang scheduler availability
def local_date_string() -> str:
    return date.today().isoformat()

def format_time(value: str) -> str:
    hour, minute = map(int, value.split(":"))
    period = "PM" if hour >= 12 else "AM"
    hour = hour % 12 or 12
    return f"{hour}:{minute:02d} {period}"

def pretty_date(value: str) -> str:
    return datetime.strptime(value, "%Y-%m-%d").strftime("%B %-d, %Y")

 #OOP: Booking n Scheduler classes to manage appointments and availability. 
@dataclass
class Booking:
    ownerName: str
    petName: str
    petType: str
    visitReason: str
    address: str
    contact: str
    types: list[str]
    referenceCode: str
    summary: str
    id: str
    date: str
    time: str
    restTime: str

    def to_dict(self):
        return asdict(self)

#Here, I used encapsulation
class Scheduler:
    """In-memory appointment scheduler. No database or persistent storage."""

    def __init__(self): #specifically i encapsulated the scheduling state n operations within the Scheduler class for centralized lock management
        self._availability: dict[str, dict[str, str]] = {
            local_date_string(): {"start": "08:00", "end": "18:00"}
        }
        self._bookings: list[Booking] = []
        self._lock = Lock() # Added a thread lock so only one request at a time can modify the shared scheduling data.

    @staticmethod
    def _to_minutes(value: str) -> int:
        hour, minute = map(int, value.split(":"))
        return hour * 60 + minute

    @staticmethod
    def _to_time(minutes: int) -> str:
        return f"{minutes // 60:02d}:{minutes % 60:02d}"

    def publish(self, day: str, start: str, end: str):
        if not day or not start or not end:
            raise ValueError("Please complete the date and both hours.")
        if start >= end:
            raise ValueError("The end time needs to be after the start time.")
        if self._to_minutes(end) - self._to_minutes(start) < 60:
            raise ValueError("Availability must include at least one hour.")
        with self._lock:
            self._availability[day] = {"start": start, "end": end}

    def available_dates(self):
        with self._lock:
            return sorted(self._availability)

    def all_availability(self):
        with self._lock:
            return [
                {"date": day, **self._availability[day]}
                for day in sorted(self._availability)
            ]

    def slots_for(self, day: str):
        with self._lock:
            hours = self._availability.get(day)
            if not hours:
                return []
            start = self._to_minutes(hours["start"])
            end = self._to_minutes(hours["end"])
            bookings = [b for b in self._bookings if b.date == day]

        slots = []
        for minutes in range(start, end, 60):
            if minutes + 60 > end:
                break
            time = self._to_time(minutes)
            booking = next(
                (b for b in bookings if b.time == time or b.restTime == time), None
            )
            slots.append({
                "time": time,
                "state": "open" if booking is None else ("booked" if booking.time == time else "rest"),
                "label": format_time(time),
            })
        return slots

    def book(self, day: str, time: str, details: dict):
        with self._lock:
            chosen = next((s for s in self.slots_for_unlocked(day) if s["time"] == time), None)
            if not chosen or chosen["state"] != "open":
                raise ValueError("That time is no longer available. Please choose another one.")

            reference = details.get("referenceCode") or f"PAW-{uuid4().hex[:6].upper()}"
            booking = Booking(
                ownerName=details["ownerName"],
                petName=details["petName"],
                petType=details["petType"],
                visitReason=details.get("visitReason", ""),
                address=details["address"],
                contact=details["contact"],
                types=details["types"],
                referenceCode=reference,
                summary=details["summary"],
                id=str(uuid4()),
                date=day,
                time=time,
                restTime=self._to_time(self._to_minutes(time) + 60),
            )
            self._bookings.append(booking)
            return booking

    def slots_for_unlocked(self, day: str):
        hours = self._availability.get(day)
        if not hours:
            return []
        start = self._to_minutes(hours["start"])
        end = self._to_minutes(hours["end"])
        bookings = [b for b in self._bookings if b.date == day]
        result = []
        for minutes in range(start, end, 60):
            if minutes + 60 > end:
                break
            time = self._to_time(minutes)
            booking = next((b for b in bookings if b.time == time or b.restTime == time), None)
            result.append({
                "time": time,
                "state": "open" if booking is None else ("booked" if booking.time == time else "rest"),
                "label": format_time(time),
            })
        return result

    def bookings(self):
        with self._lock:
            return [b.to_dict() for b in sorted(self._bookings, key=lambda x: (x.date, x.time))]

    def find_by_reference(self, reference: str):
        ref = reference.strip().upper()
        with self._lock:
            booking = next((b for b in self._bookings if b.referenceCode == ref), None)
            return booking.to_dict() if booking else None

scheduler = Scheduler()

def visit_summary(details: dict) -> str:
    visit_type = ", ".join(
        f"Others — {details.get('visitReason', '').strip()}" if t == "Others" and details.get("visitReason", "").strip() else t
        for t in details["types"]
    )
    return (
        f"{details['petName']} is a {details['petType']} scheduled for {visit_type}. "
        f"The intake was submitted by {details['ownerName']}; contact details and address are on file. "
        "Confirm the pet's current condition, history, and any clinic-specific consent requirements during the visit."
    )

def validate_customer(details: dict):
    required = ("ownerName", "petName", "petType", "address", "contact", "types")
    if any(not details.get(key) for key in required):
        raise ValueError("Please complete all required pet and owner details.")
    if not details["types"]:
        raise ValueError("Please choose at least one appointment type.")
    if "Others" in details["types"] and not details.get("visitReason", "").strip():
        raise ValueError("Please specify your appointment/service when 'Others' is selected.")
    if "Spay/Neuter" in details["types"] and "Grooming" in details["types"]:
        raise ValueError("The combination 'Spay/Neuter' + 'Grooming' is not allowed.")
    if not re.fullmatch(r"09\d{9}", details["contact"]):
        raise ValueError("Please enter a valid 11-digit contact number (e.g. 09171234567).")

@app.get("/")
def index():
    return render_template("index.html")

@app.get("/api/availability")
def get_availability():
    return jsonify(scheduler.all_availability())

@app.post("/api/availability")
def publish_availability():
    data = request.get_json(silent=True) or {}
    try:
        scheduler.publish(data.get("date", ""), data.get("start", ""), data.get("end", ""))
        return jsonify({"ok": True, "availability": scheduler.all_availability()})
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400

@app.get("/api/slots/<day>")
def get_slots(day):
    return jsonify(scheduler.slots_for(day))

@app.get("/api/bookings")
def get_bookings():
    return jsonify(scheduler.bookings())

@app.post("/api/bookings")
def create_booking():
    data = request.get_json(silent=True) or {}
    try:
        validate_customer(data)
        data["referenceCode"] = f"PAW-{uuid4().hex[:6].upper()}"
        data["summary"] = visit_summary(data)
        booking = scheduler.book(data.get("date", ""), data.get("time", ""), data)
        return jsonify({"ok": True, "booking": booking.to_dict()})
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
@app.get("/api/bookings/<reference>")
def lookup_booking(reference):
    booking = scheduler.find_by_reference(reference)
    return jsonify({"booking": booking})

if __name__ == "__main__":
    app.run(debug=True) 