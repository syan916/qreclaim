# ==============================
#  SAMPLE DATA FOR QRECLAIM SYSTEM
# ==============================

# ==== USERS ====
db.collection("users").document("2408473").set({
    "user_id": "2408473",
    "name": "Lee Song Yan",
    "email": "leesy-jm22@student.tarc.edu.my",
    "password": "240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9",
    "role": "student",
    "course": "RSD",
    "department": None,
    "rfid_id": "rfid_abc123",
    "status": "active",
    "contact_number": "0123456789",
})

db.collection("users").document("2408501").set({
    "user_id": "2408501",
    "name": "Lim Wei Xiang",
    "email": "limwx-jm24@student.tarc.edu.my",
    "password": "240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9",
    "role": "student",
    "course": "DFT",
    "department": None,
    "rfid_id": "rfid_xyz456",
    "status": "active",
    "contact_number": "0112345678",
})

db.collection("users").document("4023").set({
    "user_id": "4023",
    "name": "Mr. Tan Wei Sheng",
    "email": "tanws@tarc.edu.my",
    "password": "240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9",
    "role": "admin",
    "course": None,
    "department": "Security Office",
    "rfid_id": None,
    "status": "active",
    "contact_number": "0177654321",
})

db.collection("users").document("4029").set({
    "user_id": "4029",
    "name": "Ms. Wong Pei Ying",
    "email": "wongpy@tarc.edu.my",
    "password": "240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9",
    "role": "admin",
    "course": None,
    "department": "Admin Department",
    "rfid_id": None,
    "status": "active",
    "contact_number": "0198881122",
})


# ==== LOST ITEMS ====
db.collection("lost_items").document("LI0001").set({
    "lost_item_id": "LI0001",
    "reported_by": "2408473",
    "category": "Personal Accessories",
    "lost_item_name": "Wallet",
    "description": "Black leather wallet with IC and TARC card inside",
    "image_url": "<base64_image_string_here>",
    "tags": ["#black", "#leather", "#wallet"],
    "place_lost": "Cafeteria",
    "time_lost": firestore.SERVER_TIMESTAMP,
    "is_valuable": True,
    "remarks": None,
    "status": "open",
    "created_at": firestore.SERVER_TIMESTAMP,
    "updated_at": firestore.SERVER_TIMESTAMP,
})


# ==== FOUND ITEMS ====
db.collection("found_items").document("FI0001").set({
    "found_item_id": "FI0001",
    "uploaded_by": "4023",
    "locker_id": "LK0001",
    "category": "Personal Accessories",
    "found_item_name": "Wallet",
    "description": "Black wallet found near Block A staircase",
    "image_url": "<base64_image_string_here>",
    "tags": ["black", "leather", "wallet"],
    "place_found": "Block A Staircase",
    "time_found": firestore.SERVER_TIMESTAMP,
    "is_valuable": True,
    "is_assigned_to_locker": True,
    "remarks": None,
    "status": "unclaimed",
    "created_at": firestore.SERVER_TIMESTAMP,
    "updated_at": firestore.SERVER_TIMESTAMP,
})


# ==== CLAIMS ====
db.collection("claims").document("C0001").set({
    "claim_id": "C0001",
    "found_item_id": "FI0001",
    "student_id": "2408501",
    "face_embedding": None,
    "face_image_base64": None,
    "verification_method": None, 
    "status": "pending",
    "qr_token": None,
    "qr_image_url": "https://example.com/qr0002.png",
    "expires_at": None,
    "student_remarks": None,
    "admin_remarks": None,
    "approved_by": None,
    "approved_at": None,
    "verified_at": None,
})


# ==== LOCKERS ====
db.collection("lockers").document("LK0001").set({
    "locker_id": "LK0001",
    "status": "occupied",
    "assigned_item_id": "FI0001",
    "location": "Block A – Smart Locker Station",
    "last_updated": firestore.SERVER_TIMESTAMP
})

db.collection("lockers").document("LK0002").set({
    "locker_id": "LK0002",
    "status": "empty",
    "assigned_item_id": None,
    "location": "Block A – Smart Locker Station",
    "last_updated": firestore.SERVER_TIMESTAMP
})

db.collection("lockers").document("LK0003").set({
    "locker_id": "LK0003",
    "status": "empty",
    "assigned_item_id": None,
    "location": "Block B – Smart Locker Station",
    "last_updated": firestore.SERVER_TIMESTAMP
})

db.collection("lockers").document("LK0004").set({
    "locker_id": "LK0004",
    "status": "empty",
    "assigned_item_id": None,
    "location": "Block C – Smart Locker Station",
    "last_updated": firestore.SERVER_TIMESTAMP
})


# ==== NOTIFICATIONS ====
db.collection("notifications").document("N0001").set({
    "notification_id": "N0001",
    "recipient_id": "2408473",
    "item_id": "FI0001",
    "message": "A found wallet may match your lost report. Please review.",
    "read": False,
    "sent_at": firestore.SERVER_TIMESTAMP
})


# ==== ADMIN REVIEWS ====
db.collection("admin_reviews").document("AR0001").set({
    "review_id": "AR0001",
    "found_item_id": "FI0001",
    "reviewed_by": "4023",
    "review_status": "donate",
    "review_date": firestore.SERVER_TIMESTAMP,
    "notes": "Unclaimed for 30 days. Ready for donation."
})




-- db.collection("claims").document("C0002").set({
--     "claim_id": "C0002",
--     "found_item_id": "FI0003",
--     "student_id": "2408600",
--     "registration_id": "QR0001",
--     "face_embedding": None,
--     "status": "approved",
--     "qr_token": None,
--     "verified_at": firestore.SERVER_TIMESTAMP,
--     "expires_at": None,
--     "review_required": False,
--     "admin_remarks": "",
--     "reviewed_by": "4031",
--     "reviewed_at": firestore.SERVER_TIMESTAMP
-- })

-- # ==== QR REGISTRATIONS ====
-- db.collection("qr_registrations").document("QR0001").set({
--     "registration_id": "QR0001",
--     "found_item_id": "FI0001",
--     "student_id": "2408473",
--     "requested_at": firestore.SERVER_TIMESTAMP,
--     "status": "pending",
--     "approved_by": None,
--     "approved_at": None,
--     "qr_token": "qr_token_xyz987",
--     "qr_image_url": "https://example.com/qr0001.png",
--     "student_remarks": None,
--     "verification_method": "", 
--     "expires_at": "null"
-- })