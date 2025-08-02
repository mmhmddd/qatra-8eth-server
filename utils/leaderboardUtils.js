// Calculate rank score based on volunteer hours and number of students
export const calculateRankScore = (volunteerHours, numberOfStudents) => {
  const volunteerWeight = 0.6; // 60% weight for volunteer hours
  const studentWeight = 0.4;  // 40% weight for number of students
  return (volunteerHours || 0) * volunteerWeight + (numberOfStudents || 0) * studentWeight;
};