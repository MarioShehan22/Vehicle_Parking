import React, { useEffect, useState } from "react";
import api from "../config/axios.js";

export default function UsersTable() {
    const [users, setUsers] = useState([]);

    useEffect(() => {
        api.get("/api/user")
            .then((res) => {
                if (res.data.success && Array.isArray(res.data.events)) {
                    setUsers(res.data.events);
                }
            })
            .catch((err) => console.error("Error fetching users:", err));
    }, []);


    return (
        <div className="p-6">
            <h2 className="text-xl font-bold mb-4">User List</h2>
            <table className="min-w-full border border-gray-300">
                <thead>
                <tr className="bg-gray-100">
                    <th className="border px-4 py-2">Username</th>
                    <th className="border px-4 py-2">Email</th>
                    <th className="border px-4 py-2">Card ID</th>
                    <th className="border px-4 py-2">Vehicle No.</th>
                    <th className="border px-4 py-2">Role</th>
                    <th className="border px-4 py-2">Active</th>
                    <th className="border px-4 py-2">Joined</th>
                    <th className="border px-4 py-2">Last Login</th>
                </tr>
                </thead>
                <tbody>
                {users.map((u) => (
                    <tr key={u._id} className="text-center">
                        <td className="border px-4 py-2">{u.username}</td>
                        <td className="border px-4 py-2">{u.email}</td>
                        <td className="border px-4 py-2">{u.cardId}</td>
                        <td className="border px-4 py-2">{u.vehicleNumber}</td>
                        <td className="border px-4 py-2">{u.role}</td>
                        <td className="border px-4 py-2">
                            {u.is_active ? "✅" : "❌"}
                        </td>
                        <td className="border px-4 py-2">
                            {new Date(u.date_joined).toLocaleString()}
                        </td>
                        <td className="border px-4 py-2">
                            {new Date(u.last_login).toLocaleString()}
                        </td>
                    </tr>
                ))}
                </tbody>
            </table>
        </div>
    );
}
