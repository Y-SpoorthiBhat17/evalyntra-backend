const User = require("./models/User");

const getCombinedClassData = async (req, res) => {
    try {
        const result = await User.aggregate([
            {
                // Group by the 4 identical fields from your schema
                $group: {
                    _id: {
                        college: "$college",
                        branch: "$branch",
                        year: "$year",
                        section: "$section"
                    },
                    // Collects all students and lecturers into one list
                    allMembers: {
                        $push: {
                            name: "$name",
                            role: "$role",
                            subject: "$subject",
                            usn: "$usn"
                        }
                    },
                    count: { $sum: 1 }
                }
            }
        ]);
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ message: "Error grouping data", error: error.message });
    }
};

module.exports = { getCombinedClassData };