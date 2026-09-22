package com.aaiagent.data.db.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "user_location")
data class UserLocationEntity(
    @PrimaryKey val id: Int = 1,
    @ColumnInfo(name = "home_city") val homeCity: String = "",
    @ColumnInfo(name = "home_district") val homeDistrict: String = "",
    @ColumnInfo(name = "work_city") val workCity: String = "",
    @ColumnInfo(name = "work_district") val workDistrict: String = ""
)
